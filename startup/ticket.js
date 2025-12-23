/**
 * Naprawiony i zlokalizowany skrypt ticketów (polski)
 *
 * - Gdy naciśniesz "Zamknij ticket" wysyłana jest informacja, że za 5s ticket zostanie przeniesiony do kategorii zamkniętych (<#CLOSED_CATEGORY_ID>)
 *   oraz że po 10 godzinach kanał zostanie automatycznie usunięty.
 * - Wszystkie odpowiedzi/interakcje są w języku polskim.
 * - Poprawiono drobne problemy (np. użycie numeru ticketa z modalów).
 *
 * Uwaga:
 * - Upewnij się, że ID (TICKET_CHANNEL_ID, ADMIN_ROLE_ID, ...) są poprawne dla Twojego serwera.
 * - Skrypt zakłada discord.js v14+.
 */

const {
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ButtonBuilder,
  ButtonStyle,
  Events,
  PermissionsBitField,
  ChannelType,
} = require('discord.js');

let ticketNumberCounter = 0;
let transactionCounter = 0;
const ticketData = new Map(); // channelId -> { ownerId, transactionId, ticketNumber, category, createdAt, closeTimeoutId, closeConfirmTimeoutId }

module.exports = (client) => {
  // Konfiguracja - zmień ID jeśli potrzeba
  const TICKET_CHANNEL_ID = '1312759128627871816'; // kanał z embedem wyboru kategorii
  const ADMIN_ROLE_ID = '1436376487157694586';
  const MOD_BUTTONS_ROLE_ID = '1321051189848047636';
  const TICKETS_CATEGORY_ID = '1313052528761503795';
  const CLOSED_CATEGORY_ID = '1453095347940491464';
  const LOG_CHANNEL_ID = '1452581189415338135';
  const AUTO_DELETE_AFTER_MS = 10 * 60 * 60 * 1000; // 10 godzin

  const getEmoji = (id) => client.emojis.cache.get(id)?.toString() || '';

  // --- Helpers ---

  // Wyślij loga do kanału LOG_CHANNEL_ID jeśli istnieje i bot ma dostęp
  const sendLog = async (title, description = '', fields = [], color = 'Blue') => {
    try {
      const logCh = await client.channels.fetch(LOG_CHANNEL_ID).catch(() => null);
      if (!logCh) return;
      const embed = new EmbedBuilder()
        .setTitle(title)
        .setDescription(description || '')
        .setColor(color)
        .setTimestamp();
      if (fields.length) embed.addFields(fields);
      await logCh.send({ embeds: [embed] }).catch(() => {});
    } catch (err) {
      console.error('[ticket] Błąd przy wysyłaniu loga:', err);
    }
  };

  // Usuń stare menu bota z kanału (by uniknąć "Only the person who initiated..." blokad)
  const deleteOldSetupMessages = async (channel) => {
    try {
      const messages = await channel.messages.fetch({ limit: 200 });
      const botMessages = messages.filter((m) =>
        m.author?.id === client.user.id &&
        (m.components?.some((row) => row.components?.some((c) => c.customId && c.customId.includes('TICKET_MENU'))) ||
          m.embeds?.some((e) => e.title && e.title.includes('Wybierz kategorię')))
      );
      for (const [, msg] of botMessages) await msg.delete().catch(() => {});
    } catch (err) {
      console.error('[ticket] Błąd przy usuwaniu starych wiadomości setup:', err);
    }
  };

  // Wysyła publiczną wiadomość z menu (customId zawiera 'TICKET_MENU' aby odróżnić)
  const sendSetupMessage = async (channel) => {
    const embed = new EmbedBuilder()
      .setTitle('💡 Wybierz kategorię')
      .setDescription(
        '<:inne:1452715580456042647> Potrzebujesz pomocy lub kontaktu innego niż zakup? Wybierz kategorię **INNE**\n' +
        '<:zakupy:1453054774172975124> Interesuje Cię zakup? Wybierz kategorię **ZAKUPY**'
      )
      .setColor('Blue')
      .setImage('https://cdn.discordapp.com/attachments/1312840154070777889/1453012826334695455/logo_spr.png');

    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId('TICKET_MENU::ticket_category')
      .setPlaceholder('💡 Wybierz kategorię ticketa...')
      .addOptions([
        { label: 'INNE', description: 'Problemy niezwiązane z zakupem', value: 'inne', emoji: { id: '1452715580456042647' } },
        { label: 'ZAKUPY', description: 'Zakup sprawdzianu/kartkówki', value: 'zakupy', emoji: { id: '1453054774172975124' } }
      ])
      .setMinValues(1)
      .setMaxValues(1);

    const row = new ActionRowBuilder().addComponents(selectMenu);
    return channel.send({ embeds: [embed], components: [row] });
  };

  // Odtworzenie podstawowych danych ticketa z kanału jeśli ticketData nie istnieje (fallback po restarcie)
  // Próbuje znaleźć w permissionOverwrites wpis użytkownika z allow SendMessages (najczęściej właściciel)
  const rebuildTicketDataFromChannel = async (channel) => {
    try {
      const overwrites = channel.permissionOverwrites.cache;
      // znajdź nadpisanie typu member z SendMessages: true
      const memberOverwrite = overwrites.find((ow) =>
        !isNaN(Number(ow.id)) &&
        (ow.type === 'member' || ow.type === 1 || ow.type === 'user') &&
        ow.allow?.has?.(PermissionsBitField.Flags.SendMessages)
      );
      if (memberOverwrite) {
        const ownerId = memberOverwrite.id;
        const category = channel.name.startsWith('🛒') ? 'ZAKUPY' : channel.name.startsWith('❓') ? 'INNE' : 'INNE';
        const ticketNumber = null;
        const transactionId = null;
        const createdAt = channel.createdAt ? channel.createdAt.toISOString() : new Date().toISOString();
        const data = { ownerId, transactionId, ticketNumber, category, createdAt, closeTimeoutId: null, closeConfirmTimeoutId: null };
        ticketData.set(channel.id, data);
        return data;
      }
    } catch (err) {
      console.error('[ticket] rebuildTicketDataFromChannel error:', err);
    }
    return null;
  };

  // Pobiera dane ticketa lub próbuje je odtworzyć
  const getTicketData = async (channelId, guild) => {
    let data = ticketData.get(channelId);
    if (data) return data;
    try {
      const ch = await guild.channels.fetch(channelId).catch(() => null);
      if (!ch) return null;
      data = await rebuildTicketDataFromChannel(ch);
      return data;
    } catch (err) {
      return null;
    }
  };

  // Wykonaj zamknięcie ticketa (przeniesienie do CLOSED_CATEGORY_ID, zablokowanie wysyłania wiadomości dla ownera, zaplanowanie usunięcia)
  const performClose = async (channelId, closedByUserId) => {
    try {
      const stored = ticketData.get(channelId);
      // spróbuj pobrać kanał
      const ch = await client.channels.fetch(channelId).catch(() => null);
      if (!ch) {
        if (stored) ticketData.delete(channelId);
        return;
      }
      const ticket = stored || { ticketNumber: null, category: null, ownerId: null };
      const ownerId = ticket.ownerId;

      // ustaw uprawnienia: owner - view only, admins & mods - view+send
      // Używamy .edit aby nie nadpisać innych wpisów
      try {
        if (ownerId) await ch.permissionOverwrites.edit(ownerId, { ViewChannel: true, SendMessages: false, ReadMessageHistory: true }).catch(() => {});
        if (ADMIN_ROLE_ID) await ch.permissionOverwrites.edit(ADMIN_ROLE_ID, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true }).catch(() => {});
        if (MOD_BUTTONS_ROLE_ID) await ch.permissionOverwrites.edit(MOD_BUTTONS_ROLE_ID, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true }).catch(() => {});
      } catch (errPerm) {
        // Ignoruj błędy uprawnień, ale loguj
        console.error('[ticket] Błąd przy edycji nadpisań uprawnień:', errPerm);
      }

      // przenieś do kategorii zamkniętych
      await ch.setParent(CLOSED_CATEGORY_ID).catch(() => {});

      // wyślij informację w kanale
      await ch.send({ content: `🔒 Ticket przeniesiony do archiwum (<#${CLOSED_CATEGORY_ID}>) przez <@${closedByUserId}>.\n⏳ Kanał zostanie automatycznie usunięty za 10 godzin.` }).catch(() => {});

      // zaplanuj automatyczne usunięcie po 10h
      const timeoutId = setTimeout(async () => {
        try {
          const toDel = await client.channels.fetch(channelId).catch(() => null);
          if (toDel) await toDel.delete().catch(() => {});
        } catch (err) {
          console.error('[ticket] Błąd przy automatycznym usuwaniu kanału:', err);
        } finally {
          ticketData.delete(channelId);
          await sendLog(`Usunięto ticket`, `Automatyczne usunięcie ticketu po zamknięciu.`, [
            { name: 'Kanał', value: `<#${channelId}>` },
            { name: 'Zamknięte przez', value: `<@${closedByUserId}>` }
          ], 'Grey');
        }
      }, AUTO_DELETE_AFTER_MS);

      if (!stored) ticketData.set(channelId, { ownerId, transactionId: null, ticketNumber: null, category: null, createdAt: new Date().toISOString(), closeTimeoutId: timeoutId, closeConfirmTimeoutId: null });
      else {
        // wyczyść ewentualny confirm timeout
        if (stored.closeConfirmTimeoutId) {
          try { clearTimeout(stored.closeConfirmTimeoutId); } catch (e) { }
          stored.closeConfirmTimeoutId = null;
        }
        stored.closeTimeoutId = timeoutId;
        ticketData.set(channelId, stored);
      }

      // log
      await sendLog('Zamknięto ticket', `Ticket przeniesiony do archiwum.`, [
        { name: 'Kanał', value: `<#${channelId}>` },
        { name: 'Zamknięte przez', value: `<@${closedByUserId}>` }
      ], 'Orange');
    } catch (err) {
      console.error('[ticket] performClose error:', err);
    }
  };

  // --- Ready / setup message ---
  client.once(Events.ClientReady, async () => {
    try {
      const ch = await client.channels.fetch(TICKET_CHANNEL_ID).catch(() => null);
      if (!ch) return console.log('[ticket] Nie znaleziono kanału ticketowego');
      await deleteOldSetupMessages(ch);
      await sendSetupMessage(ch);
      console.log('[ticket] Menu ticketowe wysłane.');
    } catch (err) {
      console.error('[ticket] Ready error:', err);
    }
  });

  // /setup command (opcjonalnie) - tylko admin
  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    if (interaction.commandName !== 'setup') return;
    if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator) && !interaction.member.roles.cache.has(ADMIN_ROLE_ID)) {
      await interaction.reply({ content: '❌ Nie masz uprawnień do uruchomienia tej komendy.', ephemeral: true });
      return;
    }
    await deleteOldSetupMessages(interaction.channel);
    await sendSetupMessage(interaction.channel);
    await interaction.reply({ content: '✅ Menu ticketowe wysłane publicznie na kanale.', ephemeral: true });
  });

  // --- Select menu -> show modal ---
  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isStringSelectMenu()) return;
    if (!interaction.customId?.includes('TICKET_MENU::ticket_category')) return;

    const user = interaction.user;
    ticketNumberCounter += 1;
    const currentTicketNumber = ticketNumberCounter; // zapamiętujemy numer dla modala

    let modal;
    if (interaction.values[0] === 'inne') {
      modal = new ModalBuilder()
        .setCustomId(`modal_inne::${user.id}::${currentTicketNumber}`)
        .setTitle('INNE')
        .addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('opis_problem').setLabel('Opisz problem').setStyle(TextInputStyle.Paragraph).setRequired(true)
          )
        );
    } else {
      modal = new ModalBuilder()
        .setCustomId(`modal_zakupy::${user.id}::${currentTicketNumber}`)
        .setTitle('ZAKUPY')
        .addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('produkt').setLabel('Co chcesz zakupić?').setStyle(TextInputStyle.Short).setRequired(true)
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('wydawnictwo').setLabel('Wydawnictwo').setStyle(TextInputStyle.Short).setRequired(true)
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('platnosc').setLabel('Czym będziesz płacił?').setStyle(TextInputStyle.Short).setRequired(true)
          )
        );
    }

    await interaction.showModal(modal).catch(async (err) => {
      console.error('[ticket] showModal error:', err);
      await interaction.reply({ content: '❌ Nie udało się otworzyć formularza. Spróbuj ponownie.', ephemeral: true }).catch(() => {});
    });
  });

  // --- Modal submit -> create ticket channel ---
  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isModalSubmit()) return;

    const parts = interaction.customId.split('::'); // [modal_type, userId, ticketNumber]
    if (parts.length < 3) {
      await interaction.reply({ content: '❌ Nieprawidłowy formularz.', ephemeral: true });
      return;
    }
    const modalType = parts[0];
    const userIdFromModal = parts[1];
    const modalTicketNumberRaw = parts[2];
    const modalTicketNumber = Number(modalTicketNumberRaw) || (++ticketNumberCounter);

    const user = interaction.user;
    // Umożliwiamy submit nawet jeśli ID się nie zgadza (zgodnie z życzeniem)
    // Można to zmienić jeśli chcesz stricte weryfikować.

    const now = new Date();
    const createdDateStr = now.toLocaleString('pl-PL', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    });

    const ePing = getEmoji('1453068281979076691');
    const eTag = getEmoji('1452951976785481741');
    const eUserId = getEmoji('1452715580456042647');
    const eSpacer = getEmoji('1452712355002585330');
    const eTrans = getEmoji('1453070829285019658');

    let category, channelName, embedFields = [], transactionId = null;

    if (modalType === 'modal_inne') {
      const opis = interaction.fields.getTextInputValue('opis_problem');
      category = 'INNE';
      channelName = `❓|${user.username}`;

      embedFields = [
        { name: 'Informacje o użytkowniku', value: `${ePing} Ping: <@${user.id}>\n${eTag} TAG: ${user.tag}\n${eUserId} ID użytkownika: ${user.id}` },
        { name: 'Opis problemu', value: `> ${opis}` }
      ];
    } else {
      const produkt = interaction.fields.getTextInputValue('produkt');
      const wydawnictwo = interaction.fields.getTextInputValue('wydawnictwo');
      const platnosc = interaction.fields.getTextInputValue('platnosc');
      category = 'ZAKUPY';
      channelName = `🛒|${user.username}`;

      transactionCounter += 1;
      transactionId = transactionCounter;

      embedFields = [
        { name: 'Informacje o użytkowniku', value: `${ePing} Ping: <@${user.id}>\n${eTag} TAG: ${user.tag}\n${eUserId} ID użytkownika: ${user.id} ${eSpacer}` },
        { name: 'Informacje o transakcji', value: `ID transakcji: ${transactionId}\nKategoria: ${category}\nProdukt: ${produkt}\nWydawnictwo: ${wydawnictwo}\nMetoda płatności: ${platnosc}` }
      ];
    }

    // Tworzenie kanału
    let ticketChannel;
    try {
      ticketChannel = await interaction.guild.channels.create({
        name: channelName,
        type: ChannelType.GuildText,
        parent: TICKETS_CATEGORY_ID,
        permissionOverwrites: [
          { id: interaction.guild.roles.everyone, deny: [PermissionsBitField.Flags.ViewChannel] },
          { id: user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] },
          { id: ADMIN_ROLE_ID, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ManageChannels, PermissionsBitField.Flags.ReadMessageHistory] },
          { id: MOD_BUTTONS_ROLE_ID, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] }
        ]
      });
    } catch (err) {
      console.error('[ticket] Błąd przy tworzeniu kanału:', err);
      await interaction.reply({ content: '❌ Wystąpił błąd podczas tworzenia kanału ticketowego.', ephemeral: true });
      return;
    }

    // Zapisz dane ticketa (używamy numeru z modala, jeżeli istnieje)
    ticketData.set(ticketChannel.id, {
      ownerId: user.id,
      transactionId,
      ticketNumber: modalTicketNumber,
      category,
      createdAt: now.toISOString(),
      closeTimeoutId: null,
      closeConfirmTimeoutId: null
    });

    // Embed z datą i godziną w stopce
    const ticketEmbed = new EmbedBuilder()
      .setTitle(`Ticket #${modalTicketNumber} | ${category}`)
      .setColor(category === 'ZAKUPY' ? 'Red' : 'Orange')
      .setFields(embedFields)
      .setThumbnail(user.displayAvatarURL({ dynamic: true, size: 1024 }))
      .setFooter({ text: `Utworzony przez: ${user.tag} • ${createdDateStr}` });

    const buttons = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`close_ticket::${ticketChannel.id}`).setLabel('Zamknij ticket').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(`admin_panel::${ticketChannel.id}`).setLabel('Panel administracyjny').setStyle(ButtonStyle.Primary)
    );

    // Wyślij wiadomość do kanału ticketowego
    await ticketChannel.send({ content: `🔔 <@${user.id}> — Twój ticket został utworzony.`, embeds: [ticketEmbed], components: [buttons] }).catch(() => {});

    // Odpowiedz autorowi
    await interaction.reply({ content: `✅ Twój ticket został utworzony: <#${ticketChannel.id}>`, ephemeral: true });

    // Wyślij log
    await sendLog('Utworzono ticket', `Utworzono ticket #${modalTicketNumber}`, [
      { name: 'Ticket', value: `#${modalTicketNumber} | ${category}` },
      { name: 'Kanał', value: `<#${ticketChannel.id}>` },
      { name: 'Użytkownik', value: `<@${user.id}> (${user.tag})` },
      { name: 'Transaction ID', value: transactionId ? String(transactionId) : 'brak' },
      { name: 'Data utworzenia', value: createdDateStr }
    ], 'Green');
  });

  // --- Button interactions ---
  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isButton()) return;

    const customId = interaction.customId;
    // Support '::' separator
    let [action, channelId] = customId.includes('::') ? customId.split('::') : [null, null];
    if (!action || !channelId) {
      // try legacy patterns
      const parts = customId.split('_');
      if (parts.length >= 3) {
        action = parts.slice(0, 2).join('_'); // e.g., close_ticket
        channelId = parts.slice(2).join('_');
      }
    }
    if (!action) {
      await interaction.reply({ content: '❌ Nieprawidłowa akcja.', ephemeral: true }).catch(() => {});
      return;
    }

    // zapewnij, że channelId istnieje — jeśli nie, użyj interaction.channelId
    if (!channelId) channelId = interaction.channelId;

    // Pobierz lub odbuduj ticket data
    const data = await getTicketData(channelId, interaction.guild);
    if (!data) {
      await interaction.reply({ content: '❌ Nie znaleziono danych dla tego ticketa (prawdopodobnie został już zamknięty).', ephemeral: true }).catch(() => {});
      return;
    }

    const ownerId = data.ownerId;
    const member = interaction.member;
    const isOwner = member.id === ownerId;
    const canUseAdminButtons = member.roles.cache.has(ADMIN_ROLE_ID) || member.roles.cache.has(MOD_BUTTONS_ROLE_ID) || member.permissions.has(PermissionsBitField.Flags.ManageChannels);

    // --- Zamknięcie - pokazanie potwierdzenia z możliwością anulowania (5s) ---
    if (action === 'close_ticket' || action === 'close') {
      if (!isOwner && !canUseAdminButtons) {
        await interaction.reply({ content: '❌ Nie masz uprawnień do zamknięcia tego ticketa.', ephemeral: true });
        return;
      }

      // jeśli już zaplanowane potwierdzenie -> poinformuj
      if (data.closeConfirmTimeoutId) {
        await interaction.reply({ content: '✅ Zamknięcie już zaplanowane. Możesz je anulować.', ephemeral: true });
        return;
      }

      // wyślij ephemeral z przyciskem anuluj
      const confirmRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`confirm_close::${channelId}`).setLabel('Zamknij teraz').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(`cancel_close::${channelId}`).setLabel('Anuluj').setStyle(ButtonStyle.Secondary)
      );

      await interaction.reply({ content: `🔔 Ticket zostanie zamknięty za 5 sekund i przeniesiony do archiwum (<#${CLOSED_CATEGORY_ID}>). Kliknij "Anuluj", aby przerwać.`, components: [confirmRow], ephemeral: true }).catch(() => {});

      // Wyślij informację także na kanale ticketa (żeby właściciel i obsługa widzieli odliczanie)
      try {
        const ch = await client.channels.fetch(channelId).catch(() => null);
        if (ch) await ch.send({ content: `🔔 Ticket zamknięty przez <@${interaction.user.id}> — przeniesienie za 5 sekund do <#${CLOSED_CATEGORY_ID}>. Kanał zostanie usunięty automatycznie po 10 godzinach.` }).catch(() => {});
      } catch (e) {
        // ignorujemy
      }

      // zaplanuj zamknięcie po 5 sekundach
      const timeoutId = setTimeout(async () => {
        // wykonaj close
        await performClose(channelId, interaction.user.id);
        // wyczyść confirm timeout
        const s = ticketData.get(channelId);
        if (s) {
          s.closeConfirmTimeoutId = null;
          ticketData.set(channelId, s);
        }
      }, 5000);

      data.closeConfirmTimeoutId = timeoutId;
      ticketData.set(channelId, data);
      return;
    }

    // Anulowanie zamknięcia
    if (action === 'cancel_close') {
      if (!data.closeConfirmTimeoutId) {
        await interaction.reply({ content: '❌ Brak zaplanowanego zamknięcia.', ephemeral: true });
        return;
      }
      clearTimeout(data.closeConfirmTimeoutId);
      data.closeConfirmTimeoutId = null;
      ticketData.set(channelId, data);
      await interaction.reply({ content: '❌ Zamknięcie zostało anulowane.', ephemeral: true });
      // powiadom kanał o anulowaniu
      try {
        const ch = await client.channels.fetch(channelId).catch(() => null);
        if (ch) await ch.send({ content: `❌ Zamknięcie ticketu anulowane przez <@${interaction.user.id}>.` }).catch(() => {});
      } catch (e) { }
      return;
    }

    // Natychmiastowe zamknięcie (bez odliczania) - przycisk "Zamknij teraz"
    if (action === 'confirm_close') {
      if (!isOwner && !canUseAdminButtons) {
        await interaction.reply({ content: '❌ Nie masz uprawnień.', ephemeral: true });
        return;
      }
      // usuń ewentualny confirm timeout
      if (data.closeConfirmTimeoutId) {
        clearTimeout(data.closeConfirmTimeoutId);
        data.closeConfirmTimeoutId = null;
      }
      await performClose(channelId, interaction.user.id);
      await interaction.reply({ content: '✅ Ticket został zamknięty natychmiast.', ephemeral: true }).catch(() => {});
      return;
    }

    // --- Panel administracyjny ---
    if (action === 'admin_panel' || action === 'admin') {
      if (!canUseAdminButtons) {
        await interaction.reply({ content: '❌ Nie masz uprawnień do otwarcia panelu administracyjnego.', ephemeral: true });
        return;
      }

      const adminEmbed = new EmbedBuilder()
        .setTitle('Panel administracyjny — funkcje')
        .setDescription('Wybierz operację dotyczącą użytkownika, który otworzył ticket.')
        .setColor('Purple')
        .addFields(
          { name: 'Użytkownik ticketa', value: `<@${ownerId}>`, inline: true },
          { name: 'Kanał', value: `<#${channelId}>`, inline: true }
        );

      const adminButtons = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`admin_ban::${channelId}`).setLabel('Zbanuj użytkownika').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(`admin_kick::${channelId}`).setLabel('Wyrzuć użytkownika').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(`admin_warn::${channelId}`).setLabel('Ostrzeż użytkownika').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`admin_giverole::${channelId}`).setLabel('Dodaj rolę użytkownikowi').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`admin_force_close::${channelId}`).setLabel('Usuń ticket (siłowo)').setStyle(ButtonStyle.Secondary)
      );

      await interaction.reply({ embeds: [adminEmbed], components: [adminButtons], ephemeral: true });
      return;
    }

    // --- Pozostałe admin akcje ---
    // Wszystkie mają format admin_action::channelId
    if (action === 'admin_ban') {
      if (!canUseAdminButtons) return interaction.reply({ content: '❌ Nie masz uprawnień.', ephemeral: true });
      const confirmRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`confirm_ban_yes::${channelId}`).setLabel('Tak — Zbanuj').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(`confirm_no::${channelId}`).setLabel('Anuluj').setStyle(ButtonStyle.Secondary)
      );
      await interaction.reply({ content: `Potwierdź zbanowanie użytkownika <@${ownerId}>.`, components: [confirmRow], ephemeral: true });
      return;
    }

    if (action === 'confirm_ban_yes') {
      if (!canUseAdminButtons) return interaction.reply({ content: '❌ Nie masz uprawnień.', ephemeral: true });
      try {
        await interaction.guild.members.ban(ownerId, { reason: `Zbanowany z panelu admina — ticket` });
        await sendLog('Zbanowano użytkownika', `Użytkownik <@${ownerId}> został zbanowany przez <@${interaction.user.id}>.`, [{ name: 'Kanał', value: `<#${channelId}>` }], 'Red');
        await interaction.reply({ content: `✅ Użytkownik <@${ownerId}> został zbanowany.`, ephemeral: true });
      } catch (err) {
        console.error('[ticket] ban error:', err);
        await interaction.reply({ content: '❌ Nie udało się zbanować użytkownika. Sprawdź uprawnienia bota.', ephemeral: true });
      }
      return;
    }

    if (action === 'admin_kick') {
      if (!canUseAdminButtons) return interaction.reply({ content: '❌ Nie masz uprawnień.', ephemeral: true });
      const confirmRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`confirm_kick_yes::${channelId}`).setLabel('Tak — Wyrzuć').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(`confirm_no::${channelId}`).setLabel('Anuluj').setStyle(ButtonStyle.Secondary)
      );
      await interaction.reply({ content: `Potwierdź wyrzucenie użytkownika <@${ownerId}>.`, components: [confirmRow], ephemeral: true });
      return;
    }

    if (action === 'confirm_kick_yes') {
      if (!canUseAdminButtons) return interaction.reply({ content: '❌ Nie masz uprawnień.', ephemeral: true });
      try {
        const memberToKick = await interaction.guild.members.fetch(ownerId).catch(() => null);
        if (!memberToKick) return interaction.reply({ content: '❌ Nie znaleziono członka.', ephemeral: true });
        await memberToKick.kick(`Wyrzucony z panelu admina — ticket`);
        await sendLog('Wyrzucono użytkownika', `Użytkownik <@${ownerId}> został wyrzucony przez <@${interaction.user.id}>.`, [{ name: 'Kanał', value: `<#${channelId}>` }], 'Orange');
        await interaction.reply({ content: `✅ Użytkownik <@${ownerId}> został wyrzucony.`, ephemeral: true });
      } catch (err) {
        console.error('[ticket] kick error:', err);
        await interaction.reply({ content: '❌ Nie udało się wyrzucić użytkownika. Sprawdź uprawnienia bota.', ephemeral: true });
      }
      return;
    }

    if (action === 'confirm_no') {
      await interaction.reply({ content: '❌ Anulowano operację.', ephemeral: true });
      return;
    }

    if (action === 'admin_warn') {
      if (!canUseAdminButtons) return interaction.reply({ content: '❌ Nie masz uprawnień.', ephemeral: true });
      const modal = new ModalBuilder().setCustomId(`modal_warn::${channelId}`).setTitle('Ostrzeż użytkownika')
        .addComponents(new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('warn_reason').setLabel('Powód ostrzeżenia').setStyle(TextInputStyle.Paragraph).setRequired(true)
        ));
      await interaction.showModal(modal);
      return;
    }

    if (action === 'admin_giverole') {
      if (!canUseAdminButtons) return interaction.reply({ content: '❌ Nie masz uprawnień.', ephemeral: true });
      const modalRole = new ModalBuilder().setCustomId(`modal_giverole::${channelId}`).setTitle('Dodaj rolę użytkownikowi')
        .addComponents(new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('role_id').setLabel('ID roli do dodania').setStyle(TextInputStyle.Short).setRequired(true)
        ));
      await interaction.showModal(modalRole);
      return;
    }

    if (action === 'admin_force_close') {
      if (!canUseAdminButtons) return interaction.reply({ content: '❌ Nie masz uprawnień.', ephemeral: true });
      try {
        const ch = await client.channels.fetch(channelId).catch(() => null);
        if (ch) await ch.delete().catch(() => {});
        const stored = ticketData.get(channelId);
        if (stored?.closeTimeoutId) clearTimeout(stored.closeTimeoutId);
        if (stored?.closeConfirmTimeoutId) clearTimeout(stored.closeConfirmTimeoutId);
        ticketData.delete(channelId);
        await sendLog('Usunięto ticket', `Ticket usunięty siłowo przez <@${interaction.user.id}>.`, [{ name: 'Kanał', value: `<#${channelId}>` }], 'Grey');
        await interaction.reply({ content: '✅ Ticket usunięty siłowo.', ephemeral: true });
      } catch (err) {
        console.error('[ticket] force close error:', err);
        await interaction.reply({ content: '❌ Nie udało się usunąć ticketa.', ephemeral: true });
      }
      return;
    }

    // default
    await interaction.reply({ content: '❌ Nieznana akcja.', ephemeral: true });
  });

  // --- Modal handling for admin warn & giverole ---
  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isModalSubmit()) return;

    const id = interaction.customId;
    if (id.startsWith('modal_warn::')) {
      const channelId = id.split('::')[1];
      const data = await getTicketData(channelId, interaction.guild);
      if (!data) {
        await interaction.reply({ content: '❌ Nie znaleziono danych ticketa.', ephemeral: true });
        return;
      }
      const reason = interaction.fields.getTextInputValue('warn_reason');
      try {
        const memberToWarn = await interaction.guild.members.fetch(data.ownerId).catch(() => null);
        if (memberToWarn) await memberToWarn.send(`Otrzymałeś ostrzeżenie na serwerze ${interaction.guild.name}.\nPowód: ${reason}`).catch(() => {});
        const ch = await client.channels.fetch(channelId).catch(() => null);
        if (ch) await ch.send({ content: `⚠️ Użytkownik <@${data.ownerId}> został ostrzeżony.\nPowód: ${reason}` }).catch(() => {});
        await sendLog('Ostrzeżono użytkownika', `Ostrzeżenie wysłane przez <@${interaction.user.id}>.`, [{ name: 'Kanał', value: `<#${channelId}>` }, { name: 'Powód', value: reason }], 'Yellow');
        await interaction.reply({ content: `✅ Ostrzeżenie wysłane do <@${data.ownerId}>.`, ephemeral: true });
      } catch (err) {
        console.error('[ticket] warn modal error:', err);
        await interaction.reply({ content: '❌ Błąd podczas wysyłania ostrzeżenia.', ephemeral: true });
      }
      return;
    }

    if (id.startsWith('modal_giverole::')) {
      const channelId = id.split('::')[1];
      const data = await getTicketData(channelId, interaction.guild);
      if (!data) {
        await interaction.reply({ content: '❌ Nie znaleziono danych ticketa.', ephemeral: true });
        return;
      }
      const roleId = interaction.fields.getTextInputValue('role_id').trim();
      try {
        const role = interaction.guild.roles.cache.get(roleId) || await interaction.guild.roles.fetch(roleId).catch(() => null);
        if (!role) return interaction.reply({ content: '❌ Nie znaleziono roli o podanym ID.', ephemeral: true });
        const memberToModify = await interaction.guild.members.fetch(data.ownerId).catch(() => null);
        if (!memberToModify) return interaction.reply({ content: '❌ Nie znaleziono członka.', ephemeral: true });
        await memberToModify.roles.add(role).catch((e) => { throw e; });
        const ch = await client.channels.fetch(channelId).catch(() => null);
        if (ch) await ch.send({ content: `✅ Dodano rolę ${role} użytkownikowi <@${data.ownerId}>.` }).catch(() => {});
        await sendLog('Dodano rolę użytkownikowi', `Rola ${role.name} dodana do <@${data.ownerId}> przez <@${interaction.user.id}>.`, [{ name: 'Kanał', value: `<#${channelId}>` }], 'Green');
        await interaction.reply({ content: `✅ Rola została dodana użytkownikowi <@${data.ownerId}>.`, ephemeral: true });
      } catch (err) {
        console.error('[ticket] giverole modal error:', err);
        await interaction.reply({ content: '❌ Nie udało się dodać roli. Sprawdź uprawnienia bota.', ephemeral: true });
      }
      return;
    }
  });

  // Sprzątanie timoutów przy zamknięciu procesu
  process.on('exit', () => {
    for (const [, data] of ticketData) {
      if (data?.closeTimeoutId) clearTimeout(data.closeTimeoutId);
      if (data?.closeConfirmTimeoutId) clearTimeout(data.closeConfirmTimeoutId);
    }
  });
};