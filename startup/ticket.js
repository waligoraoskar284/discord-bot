/**
 * ticket.js — moduł ticketowy (CommonJS)
 *
 * Wkładaj do projektu jako np. ./startup/ticket.js
 * Użycie w index.js:
 *   const initTickets = require('./startup/ticket');
 *   initTickets(client);
 *
 * Wymagania:
 * - discord.js v14
 * - Bot ma uprawnienia: ManageChannels, SendMessages, EmbedLinks, ReadMessageHistory, AttachFiles, BanMembers (jeśli używasz banów)
 *
 * Zmiany względem twojego oryginału:
 * - Dostosowane ID (panel, archiwum, logi, role) zgodnie z danymi które podałeś wcześniej.
 * - AUTO_DELETE_AFTER_MS ustawione na 24h (zgodnie z Twoim opisem).
 * - Zachowana logika: panel wysyłany przy starcie (restart service), modal, tworzenie kanału, zamknięcie z 5s, przeniesienie do archiwum, automatyczne usunięcie po 24h.
 * - Moduł eksportuje funkcję inicjalizującą — nie tworzy drugiego klienta.
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
  // ====== KONFIGURACJA - UPEWNIJ SIĘ, ŻE TO SĄ POPRAWNE ID DLA TWOJEGO SERVERA ======
  const TICKET_CHANNEL_ID = '1454069542283120642'; // kanał, gdzie wysyłany jest panel wyboru kategorii
  const ADMIN_ROLE_ID = '1321051189848047636'; // rola która może używać Panelu administracyjnego
  const MOD_BUTTONS_ROLE_ID = '1321051189848047636'; // rola moderatorów (ma widzieć zamknięte tickety)
  const TICKETS_CATEGORY_ID = '1313052528761503795'; // kategoria, w której będą tworzone tickety (otwarte)
  const CLOSED_CATEGORY_ID = '1453095347940491464'; // kategoria archiwum (tam trafiają zamknięte tickety)
  const LOG_CHANNEL_ID = '1454210870266695974'; // kanał z logami wszystkich działań
  const AUTO_DELETE_AFTER_MS = 24 * 60 * 60 * 1000; // 24 godziny (usuń po 24h w archiwum)

  const getEmoji = (id) => client.emojis.cache.get(id)?.toString() || '';

  // ====== HELPERS ======
  const sendLog = async (title, description = '', fields = [], color = 'Blue', components = []) => {
    try {
      const logCh = await client.channels.fetch(LOG_CHANNEL_ID).catch(() => null);
      if (!logCh) return;
      const embed = new EmbedBuilder()
        .setTitle(title)
        .setDescription(description || '')
        .setColor(color)
        .setTimestamp();
      if (fields.length) embed.addFields(fields);
      await logCh.send({ embeds: [embed], components }).catch(() => {});
    } catch (err) {
      console.error('[ticket] Błąd przy wysyłaniu loga:', err);
    }
  };

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

  const sendSetupMessage = async (channel) => {
    const embed = new EmbedBuilder()
      .setTitle('💡 Wybierz kategorię')
      .setDescription(
        '<:inne:1452715580456042637> Potrzebujesz pomocy lub kontaktu innego niż zakup? Wybierz kategorię **INNE**\n' +
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

  const rebuildTicketDataFromChannel = async (channel) => {
    try {
      const overwrites = channel.permissionOverwrites.cache;
      const memberOverwrite = overwrites.find((ow) =>
        !isNaN(Number(ow.id)) &&
        (ow.type === 'member' || ow.type === 1 || ow.type === 'user') &&
        ow.allow?.has?.(PermissionsBitField.Flags.SendMessages)
      );
      if (memberOverwrite) {
        const ownerId = memberOverwrite.id;
        const category = channel.name.startsWith('🛒') ? 'ZAKUPY' : channel.name.startsWith('❓') ? 'INNE' : 'INNE';
        const createdAt = channel.createdAt ? channel.createdAt.toISOString() : new Date().toISOString();
        const data = { ownerId, transactionId: null, ticketNumber: null, category, createdAt, closeTimeoutId: null, closeConfirmTimeoutId: null };
        ticketData.set(channel.id, data);
        return data;
      }
    } catch (err) {
      console.error('[ticket] rebuildTicketDataFromChannel error:', err);
    }
    return null;
  };

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

  const userHasOpenTicketInCategory = (guild, userId, wantedCategory) => {
    const channels = guild.channels.cache.filter(ch => ch.type === ChannelType.GuildText && ch.parentId === TICKETS_CATEGORY_ID);
    for (const [, ch] of channels) {
      const ow = ch.permissionOverwrites.cache.get(userId);
      if (!ow) continue;
      try {
        if (ow.allow?.has(PermissionsBitField.Flags.SendMessages)) {
          const cat = ch.name.startsWith('🛒') ? 'ZAKUPY' : ch.name.startsWith('❓') ? 'INNE' : null;
          if (cat === wantedCategory) return ch;
        }
      } catch (e) { /* ignore */ }
    }
    return null;
  };

  // Perform close -> move to archive, change perms, schedule deletion (24h)
  const performClose = async (channelId, closedByUserId) => {
    try {
      const stored = ticketData.get(channelId);
      const ch = await client.channels.fetch(channelId).catch(() => null);
      if (!ch) {
        if (stored) ticketData.delete(channelId);
        return;
      }
      const ticket = stored || { ticketNumber: null, category: null, ownerId: null, transactionId: null, createdAt: null };
      const ownerId = ticket.ownerId;

      try {
        // właściciel: nie widzi (ViewChannel: false), nie może pisać
        if (ownerId) await ch.permissionOverwrites.edit(ownerId, { ViewChannel: false, SendMessages: false, ReadMessageHistory: true }).catch(() => {});
        // ADMIN ma widzieć i pisać
        if (ADMIN_ROLE_ID) await ch.permissionOverwrites.edit(ADMIN_ROLE_ID, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true }).catch(() => {});
        // MOD role ma widzieć tylko zamknięte tickety: ViewChannel true, SendMessages false
        if (MOD_BUTTONS_ROLE_ID) await ch.permissionOverwrites.edit(MOD_BUTTONS_ROLE_ID, { ViewChannel: true, SendMessages: false, ReadMessageHistory: true }).catch(() => {});
      } catch (errPerm) {
        console.error('[ticket] Błąd przy edycji nadpisań uprawnień:', errPerm);
      }

      await ch.setParent(CLOSED_CATEGORY_ID).catch(() => {});
      await ch.send({ content: `🔒 Ticket został przeniesiony do archiwum przez <@${closedByUserId}>.\n⏳ Kanał zostanie automatycznie usunięty za 24 godziny.` }).catch(() => {});

      // zaplanuj automatyczne usunięcie po 24h
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
            { name: 'Zamknięte przez', value: `<@${closedByUserId}>` },
            { name: 'Właściciel', value: ticket.ownerId ? `<@${ticket.ownerId}>` : 'brak' },
            { name: 'Numer ticketu', value: ticket.ticketNumber ? `#${ticket.ticketNumber}` : 'brak' },
            { name: 'Transaction ID', value: ticket.transactionId ? String(ticket.transactionId) : 'brak' },
            { name: 'Utworzono', value: ticket.createdAt ? new Date(ticket.createdAt).toLocaleString('pl-PL') : 'brak' }
          ], 'Grey');
        }
      }, AUTO_DELETE_AFTER_MS);

      if (!stored) ticketData.set(channelId, { ownerId, transactionId: null, ticketNumber: null, category: null, createdAt: new Date().toISOString(), closeTimeoutId: timeoutId, closeConfirmTimeoutId: null });
      else {
        if (stored.closeConfirmTimeoutId) {
          try { clearTimeout(stored.closeConfirmTimeoutId); } catch (e) { }
          stored.closeConfirmTimeoutId = null;
        }
        stored.closeTimeoutId = timeoutId;
        ticketData.set(channelId, stored);
      }

      // Log zamknięcia
      const fields = [
        { name: 'Kanał', value: `<#${channelId}>` },
        { name: 'Zamknięte przez', value: `<@${closedByUserId}>` },
        { name: 'Właściciel', value: ticket.ownerId ? `<@${ticket.ownerId}>` : 'brak' },
        { name: 'Numer ticketu', value: ticket.ticketNumber ? `#${ticket.ticketNumber}` : 'brak' },
        { name: 'Transaction ID', value: ticket.transactionId ? String(ticket.transactionId) : 'brak' },
        { name: 'Utworzono', value: ticket.createdAt ? new Date(ticket.createdAt).toLocaleString('pl-PL') : 'brak' }
      ];
      const reopenBtn = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`log_reopen::${channelId}`).setLabel('Otwórz ponownie ticket').setStyle(ButtonStyle.Primary)
      );
      await sendLog('Zamknięto ticket', `Ticket przeniesiony do archiwum.`, fields, 'Orange', [reopenBtn]);
    } catch (err) {
      console.error('[ticket] performClose error:', err);
    }
  };

  // ====== Ready / send panel at bot start (restart service) ======
  client.once(Events.ClientReady, async () => {
    try {
      const ch = await client.channels.fetch(TICKET_CHANNEL_ID).catch(() => null);
      if (!ch) return console.log('[ticket] Nie znaleziono kanału ticketowego (TICKET_CHANNEL_ID).');
      await deleteOldSetupMessages(ch);
      await sendSetupMessage(ch);
      console.log('[ticket] Menu ticketowe wysłane / zaktualizowane.');
    } catch (err) {
      console.error('[ticket] Ready error:', err);
    }
  });

  // ====== Select menu -> show modal ======
  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isStringSelectMenu()) return;
    if (!interaction.customId?.includes('TICKET_MENU::ticket_category')) return;

    const user = interaction.user;
    const guild = interaction.guild;
    const selected = interaction.values[0]; // 'inne' lub 'zakupy'
    const wantedCategory = selected === 'zakupy' ? 'ZAKUPY' : 'INNE';

    const existingCh = userHasOpenTicketInCategory(guild, user.id, wantedCategory);
    if (existingCh) {
      await interaction.reply({ content: `❌ Masz już otwarty ticket w tej kategorii: <#${existingCh.id}>.`, ephemeral: true });
      return;
    }

    ticketNumberCounter += 1;
    const currentTicketNumber = ticketNumberCounter;

    let modal;
    if (selected === 'inne') {
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

  // ====== Modal submit -> create ticket channel ======
  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isModalSubmit()) return;

    const parts = interaction.customId.split('::'); // [modal_type, userId, ticketNumber]
    if (parts.length < 3) return;
    const modalType = parts[0];
    const modalTicketNumberRaw = parts[2];
    const modalTicketNumber = Number(modalTicketNumberRaw) || (++ticketNumberCounter);

    const user = interaction.user;
    const now = new Date();
    const createdDateStr = now.toLocaleString('pl-PL', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    });

    const ePing = getEmoji('1453068281979076691') || '';
    const eTag = getEmoji('1452951976785481741') || '';
    const eUserId = getEmoji('1452715580456042647') || '';
    const eTrans = getEmoji('1452715310095400991') || '';

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
        { name: 'Informacje o użytkowniku', value: `${ePing} Ping: <@${user.id}>\n${eTag} TAG: ${user.tag}\n${eUserId} ID użytkownika: ${user.id}` },
        { name: 'Informacje o transakcji', value: `ID transakcji: ${transactionId}\nKategoria: ${category}\nProdukt: ${produkt}\nWydawnictwo: ${wydawnictwo}\nMetoda płatności: ${platnosc}` }
      ];
    }

    const existingCh = userHasOpenTicketInCategory(interaction.guild, user.id, category);
    if (existingCh) {
      await interaction.reply({ content: `❌ Masz już otwarty ticket w tej kategorii: <#${existingCh.id}>.`, ephemeral: true });
      return;
    }

    // Tworzenie kanału - MOD role nie widzi otwartych ticketów (deny ViewChannel)
    let ticketChannel;
    try {
      ticketChannel = await interaction.guild.channels.create({
        name: channelName,
        type: ChannelType.GuildText,
        parent: TICKETS_CATEGORY_ID,
        permissionOverwrites: [
          { id: interaction.guild.roles.everyone, deny: [PermissionsBitField.Flags.ViewChannel] },
          { id: user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory, PermissionsBitField.Flags.AttachFiles] },
          { id: ADMIN_ROLE_ID, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ManageChannels, PermissionsBitField.Flags.ReadMessageHistory] },
          { id: MOD_BUTTONS_ROLE_ID, deny: [PermissionsBitField.Flags.ViewChannel] }
        ]
      });
    } catch (err) {
      console.error('[ticket] Błąd przy tworzeniu kanału:', err);
      await interaction.reply({ content: '❌ Wystąpił błąd podczas tworzenia kanału ticketowego.', ephemeral: true });
      return;
    }

    // Zapisz dane ticketa
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
      new ButtonBuilder().setCustomId(`close_ticket::${ticketChannel.id}`).setLabel('Zamknij ticket').setStyle(ButtonStyle.Danger).setEmoji('❌'),
      new ButtonBuilder().setCustomId(`admin_panel::${ticketChannel.id}`).setLabel('Panel administracyjny').setStyle(ButtonStyle.Primary).setEmoji('👑')
    );

    await ticketChannel.send({ content: `🔔 <@${user.id}>`, embeds: [ticketEmbed], components: [buttons] }).catch(() => {});
    await interaction.reply({ content: `✅ Twój ticket został utworzony: <#${ticketChannel.id}>`, ephemeral: true });

    await sendLog('Utworzono ticket', `Utworzono ticket #${modalTicketNumber}`, [
      { name: 'Ticket', value: `#${modalTicketNumber} | ${category}` },
      { name: 'Kanał', value: `<#${ticketChannel.id}>` },
      { name: 'Użytkownik', value: `<@${user.id}> (${user.tag})` },
      { name: 'Transaction ID', value: transactionId ? String(transactionId) : 'brak' },
      { name: 'Data utworzenia', value: createdDateStr }
    ], 'Green');
  });

  // ====== Button interactions ======
  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isButton()) return;

    // Deferruj natychmiast -> zapobiega "kliknij dwa razy"
    try {
      await interaction.deferReply({ ephemeral: true });
    } catch (e) { /* ignore */ }

    const customId = interaction.customId;
    let [action, channelId] = customId.includes('::') ? customId.split('::') : [null, null];
    if (!action || !channelId) {
      const parts = customId.split('_');
      if (parts.length >= 3) {
        action = parts.slice(0, 2).join('_');
        channelId = parts.slice(2).join('_');
      }
    }
    if (!action) return interaction.editReply({ content: '❌ Nieprawidłowa akcja.' }).catch(() => {});
    if (!channelId) channelId = interaction.channelId;

    if (action === 'log_reopen') {
      if (!interaction.member.roles.cache.has(ADMIN_ROLE_ID) && !interaction.member.roles.cache.has(MOD_BUTTONS_ROLE_ID) && !interaction.member.permissions.has(PermissionsBitField.Flags.ManageChannels)) {
        return interaction.editReply({ content: '❌ Nie masz uprawnień do ponownego otwarcia tego ticketa.' }).catch(() => {});
      }
      const ch = await client.channels.fetch(channelId).catch(() => null);
      if (!ch) return interaction.editReply({ content: '❌ Nie znaleziono kanału.' }).catch(() => {});

      try {
        await ch.setParent(TICKETS_CATEGORY_ID).catch(() => {});
        let stored = ticketData.get(channelId);
        if (!stored) stored = await rebuildTicketDataFromChannel(ch) || { ownerId: null, transactionId: null, ticketNumber: null, category: null, createdAt: new Date().toISOString(), closeTimeoutId: null, closeConfirmTimeoutId: null };

        if (stored.ownerId) {
          await ch.permissionOverwrites.edit(stored.ownerId, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true }).catch(() => {});
        }
        if (MOD_BUTTONS_ROLE_ID) await ch.permissionOverwrites.edit(MOD_BUTTONS_ROLE_ID, { ViewChannel: false }).catch(() => {});

        if (stored.closeTimeoutId) {
          try { clearTimeout(stored.closeTimeoutId); } catch (e) {}
          stored.closeTimeoutId = null;
        }
        ticketData.set(channelId, stored);

        await sendLog('Ponownie otwarto ticket', `Ticket został ponownie otwarty przez <@${interaction.user.id}>.`, [
          { name: 'Kanał', value: `<#${channelId}>` },
          { name: 'Otworzył', value: `<@${interaction.user.id}>` },
          { name: 'Właściciel', value: stored.ownerId ? `<@${stored.ownerId}>` : 'brak' }
        ], 'Green');

        return interaction.editReply({ content: `✅ Ticket <#${channelId}> został przywrócony i otwarty ponownie.` }).catch(() => {});
      } catch (err) {
        console.error('[ticket] log_reopen error:', err);
        return interaction.editReply({ content: '❌ Błąd podczas otwierania ticketu.' }).catch(() => {});
      }
    }

    const data = await getTicketData(channelId, interaction.guild);
    if (!data) return interaction.editReply({ content: '❌ Nie znaleziono danych dla tego ticketa.' }).catch(() => {});

    const ownerId = data.ownerId;
    const member = interaction.member;
    const isOwner = member.id === ownerId;
    const canUseAdminButtons = member.roles.cache.has(ADMIN_ROLE_ID) || member.roles.cache.has(MOD_BUTTONS_ROLE_ID) || member.permissions.has(PermissionsBitField.Flags.ManageChannels);

    // Zamknięcie (potwierdzenie -> 5s)
    if (action === 'close_ticket' || action === 'close') {
      if (!isOwner && !canUseAdminButtons) return interaction.editReply({ content: '❌ Nie masz uprawnień do zamknięcia tego ticketa.' }).catch(() => {});
      if (data.closeConfirmTimeoutId) return interaction.editReply({ content: '✅ Zamknięcie już zaplanowane.' }).catch(() => {});

      const confirmRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`confirm_close::${channelId}`).setLabel('Zamknij teraz').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(`cancel_close::${channelId}`).setLabel('Anuluj').setStyle(ButtonStyle.Secondary)
      );

      await interaction.editReply({ content: `🔔 Zamknięcie ticketu nastąpi za 5 sekund.`, components: [confirmRow] }).catch(() => {});
      try {
        const ch = await client.channels.fetch(channelId).catch(() => null);
        if (ch) await ch.send({ content: `🔔 Zamknięcie ticketu nastąpi za 5 sekund.` }).catch(() => {});
      } catch (e) {}

      const timeoutId = setTimeout(async () => {
        await performClose(channelId, interaction.user.id);
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

    if (action === 'cancel_close') {
      if (!data.closeConfirmTimeoutId) return interaction.editReply({ content: '❌ Brak zaplanowanego zamknięcia.' }).catch(() => {});
      clearTimeout(data.closeConfirmTimeoutId);
      data.closeConfirmTimeoutId = null;
      ticketData.set(channelId, data);
      try {
        const ch = await client.channels.fetch(channelId).catch(() => null);
        if (ch) await ch.send({ content: `❌ Zamknięcie ticketu anulowane przez <@${interaction.user.id}>.` }).catch(() => {});
      } catch (e) {}
      return interaction.editReply({ content: '❌ Zamknięcie zostało anulowane.' }).catch(() => {});
    }

    if (action === 'confirm_close') {
      if (!isOwner && !canUseAdminButtons) return interaction.editReply({ content: '❌ Nie masz uprawnień.' }).catch(() => {});
      if (data.closeConfirmTimeoutId) {
        clearTimeout(data.closeConfirmTimeoutId);
        data.closeConfirmTimeoutId = null;
      }
      await performClose(channelId, interaction.user.id);
      return interaction.editReply({ content: '✅ Ticket został zamknięty natychmiast.' }).catch(() => {});
    }

    // Panel administracyjny i podmenu
    if (action === 'admin_panel' || action === 'admin') {
      if (!canUseAdminButtons) return interaction.editReply({ content: '❌ Nie masz uprawnień do panelu administracyjnego.' }).catch(() => {});
      const ownerTag = (await interaction.guild.members.fetch(ownerId).then(m => m.user.tag).catch(() => 'brak')) || 'brak';
      const created = data.createdAt ? new Date(data.createdAt).toLocaleString('pl-PL') : 'brak';

      const adminMainEmbed = new EmbedBuilder()
        .setTitle('Panel administracyjny — funkcje')
        .setDescription('Wybierz operację dotyczącą użytkownika, który otworzył ticket.')
        .setColor('Purple')
        .addFields(
          { name: 'Użytkownik ticketa', value: ownerId ? `<@${ownerId}>` : 'brak', inline: true },
          { name: 'Tag', value: ownerTag, inline: true },
          { name: 'ID użytkownika', value: ownerId ? ownerId : 'brak', inline: true },
          { name: 'Kanał', value: `<#${channelId}>`, inline: true },
          { name: 'Nazwa kanału', value: (await client.channels.fetch(channelId).then(c => c.name).catch(() => 'brak')), inline: true },
          { name: 'Kategoria', value: data.category || 'brak', inline: true },
          { name: 'Numer ticketu', value: data.ticketNumber ? `#${data.ticketNumber}` : 'brak', inline: true },
          { name: 'Transaction ID', value: data.transactionId ? String(data.transactionId) : 'brak', inline: true },
          { name: 'Utworzono', value: created, inline: false }
        );

      const adminMainButtons = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`admin_moderation::${channelId}`).setLabel('Moderacja (ban/kick/warn)').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(`admin_roles::${channelId}`).setLabel('Role / Informacje').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`admin_ticketmanage::${channelId}`).setLabel('Zarządzanie ticketem').setStyle(ButtonStyle.Secondary)
      );

      return interaction.editReply({ embeds: [adminMainEmbed], components: [adminMainButtons] }).catch(() => {});
    }

    // Moderation submenu
    if (action === 'admin_moderation') {
      if (!canUseAdminButtons) return interaction.editReply({ content: '❌ Nie masz uprawnień.' }).catch(() => {});
      const moderationEmbed = new EmbedBuilder().setTitle('Moderacja użytkownika').setDescription(`Wybierz akcję dla <@${ownerId}>.`).setColor('Red');
      const moderationButtons = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`admin_ban::${channelId}`).setLabel('Zbanuj użytkownika').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(`admin_kick::${channelId}`).setLabel('Wyrzuć użytkownika').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(`admin_warn::${channelId}`).setLabel('Ostrzeż użytkownika').setStyle(ButtonStyle.Secondary)
      );
      return interaction.editReply({ embeds: [moderationEmbed], components: [moderationButtons] }).catch(() => {});
    }

    // Roles submenu
    if (action === 'admin_roles') {
      if (!canUseAdminButtons) return interaction.editReply({ content: '❌ Nie masz uprawnień.' }).catch(() => {});
      const rolesEmbed = new EmbedBuilder().setTitle('Role i informacje').setDescription('Dodaj rolę użytkownikowi lub wyświetl inne informacje.').setColor('Blue');
      const rolesButtons = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`admin_giverole::${channelId}`).setLabel('Dodaj rolę użytkownikowi').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`admin_viewinfo::${channelId}`).setLabel('Pokaż info o użytkowniku').setStyle(ButtonStyle.Secondary)
      );
      return interaction.editReply({ embeds: [rolesEmbed], components: [rolesButtons] }).catch(() => {});
    }

    // Ticket manage submenu
    if (action === 'admin_ticketmanage') {
      if (!canUseAdminButtons) return interaction.editReply({ content: '❌ Nie masz uprawnień.' }).catch(() => {});
      const tmEmbed = new EmbedBuilder().setTitle('Zarządzanie ticketem').setDescription('Akcje dotyczące samego ticketu.').setColor('Grey');
      const tmButtons = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`confirm_close::${channelId}`).setLabel('Zamknij teraz').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(`admin_force_close::${channelId}`).setLabel('Usuń ticket (siłowo)').setStyle(ButtonStyle.Secondary)
      );
      return interaction.editReply({ embeds: [tmEmbed], components: [tmButtons] }).catch(() => {});
    }

    // Admin actions: ban/kick/confirm/force etc. (skrócone, działają analogicznie do Twojego oryginału)
    if (action === 'admin_ban') {
      if (!canUseAdminButtons) return interaction.editReply({ content: '❌ Nie masz uprawnień.' }).catch(() => {});
      const confirmRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`confirm_ban_yes::${channelId}`).setLabel('Tak — Zbanuj').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(`confirm_no::${channelId}`).setLabel('Anuluj').setStyle(ButtonStyle.Secondary)
      );
      return interaction.editReply({ content: `Potwierdź zbanowanie użytkownika <@${ownerId}>.`, components: [confirmRow] }).catch(() => {});
    }

    if (action === 'confirm_ban_yes') {
      if (!canUseAdminButtons) return interaction.editReply({ content: '❌ Nie masz uprawnień.' }).catch(() => {});
      try {
        await interaction.guild.members.ban(ownerId, { reason: `Zbanowany z panelu admina — ticket` });
        await sendLog('Zbanowano użytkownika', `Użytkownik <@${ownerId}> został zbanowany przez <@${interaction.user.id}>.`, [{ name: 'Kanał', value: `<#${channelId}>` }], 'Red');
        return interaction.editReply({ content: `✅ Użytkownik <@${ownerId}> został zbanowany.` }).catch(() => {});
      } catch (err) {
        console.error('[ticket] ban error:', err);
        return interaction.editReply({ content: '❌ Nie udało się zbanować użytkownika. Sprawdź uprawnienia bota.' }).catch(() => {});
      }
    }

    if (action === 'admin_kick') {
      if (!canUseAdminButtons) return interaction.editReply({ content: '❌ Nie masz uprawnień.' }).catch(() => {});
      const confirmRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`confirm_kick_yes::${channelId}`).setLabel('Tak — Wyrzuć').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(`confirm_no::${channelId}`).setLabel('Anuluj').setStyle(ButtonStyle.Secondary)
      );
      return interaction.editReply({ content: `Potwierdź wyrzucenie użytkownika <@${ownerId}>.`, components: [confirmRow] }).catch(() => {});
    }

    if (action === 'confirm_kick_yes') {
      if (!canUseAdminButtons) return interaction.editReply({ content: '❌ Nie masz uprawnień.' }).catch(() => {});
      try {
        const memberToKick = await interaction.guild.members.fetch(ownerId).catch(() => null);
        if (!memberToKick) return interaction.editReply({ content: '❌ Nie znaleziono członka.' }).catch(() => {});
        await memberToKick.kick(`Wyrzucony z panelu admina — ticket`);
        await sendLog('Wyrzucono użytkownika', `Użytkownik <@${ownerId}> został wyrzucony przez <@${interaction.user.id}>.`, [{ name: 'Kanał', value: `<#${channelId}>` }], 'Orange');
        return interaction.editReply({ content: `✅ Użytkownik <@${ownerId}> został wyrzucony.` }).catch(() => {});
      } catch (err) {
        console.error('[ticket] kick error:', err);
        return interaction.editReply({ content: '❌ Nie udało się wyrzucić użytkownika. Sprawdź uprawnienia bota.' }).catch(() => {});
      }
    }

    if (action === 'confirm_no') {
      return interaction.editReply({ content: '❌ Anulowano operację.' }).catch(() => {});
    }

    if (action === 'admin_warn') {
      if (!canUseAdminButtons) return interaction.editReply({ content: '❌ Nie masz uprawnień.' }).catch(() => {});
      const modal = new ModalBuilder().setCustomId(`modal_warn::${channelId}`).setTitle('Ostrzeż użytkownika')
        .addComponents(new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('warn_reason').setLabel('Powód ostrzeżenia').setStyle(TextInputStyle.Paragraph).setRequired(true)
        ));
      try {
        return await interaction.showModal(modal);
      } catch (err) {
        console.error('[ticket] show modal warn error:', err);
        return interaction.editReply({ content: '❌ Nie udało się otworzyć formularza ostrzeżenia.' }).catch(() => {});
      }
    }

    if (action === 'admin_giverole') {
      if (!canUseAdminButtons) return interaction.editReply({ content: '❌ Nie masz uprawnień.' }).catch(() => {});
      const modalRole = new ModalBuilder().setCustomId(`modal_giverole::${channelId}`).setTitle('Dodaj rolę użytkownikowi')
        .addComponents(new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('role_id').setLabel('ID roli do dodania').setStyle(TextInputStyle.Short).setRequired(true)
        ));
      try {
        return await interaction.showModal(modalRole);
      } catch (err) {
        console.error('[ticket] show modal giverole error:', err);
        return interaction.editReply({ content: '❌ Nie udało się otworzyć formularza dodania roli.' }).catch(() => {});
      }
    }

    if (action === 'admin_force_close') {
      if (!canUseAdminButtons) return interaction.editReply({ content: '❌ Nie masz uprawnień.' }).catch(() => {});
      try {
        const ch = await client.channels.fetch(channelId).catch(() => null);
        if (ch) await ch.delete().catch(() => {});
        const stored = ticketData.get(channelId);
        if (stored?.closeTimeoutId) clearTimeout(stored.closeTimeoutId);
        if (stored?.closeConfirmTimeoutId) clearTimeout(stored.closeConfirmTimeoutId);
        ticketData.delete(channelId);
        await sendLog('Usunięto ticket', `Ticket usunięty siłowo przez <@${interaction.user.id}>.`, [{ name: 'Kanał', value: `<#${channelId}>` }], 'Grey');
        return interaction.editReply({ content: '✅ Ticket usunięty siłowo.' }).catch(() => {});
      } catch (err) {
        console.error('[ticket] force close error:', err);
        return interaction.editReply({ content: '❌ Nie udało się usunąć ticketa.' }).catch(() => {});
      }
    }

    if (action === 'admin_viewinfo') {
      if (!canUseAdminButtons) return interaction.editReply({ content: '❌ Nie masz uprawnień.' }).catch(() => {});
      try {
        const memberObj = await interaction.guild.members.fetch(ownerId).catch(() => null);
        const info = [];
        if (memberObj) {
          info.push({ name: 'Tag', value: memberObj.user.tag, inline: true });
          info.push({ name: 'ID', value: memberObj.id, inline: true });
          info.push({ name: 'Dołączył', value: memberObj.joinedAt ? memberObj.joinedAt.toLocaleString('pl-PL') : 'brak', inline: true });
          info.push({ name: 'Role (najważniejsze)', value: memberObj.roles.cache.map(r => r.name).slice(-5).join(', ') || 'brak' });
        } else {
          info.push({ name: 'Informacja', value: 'Nie można pobrać informacji o użytkowniku.' });
        }
        return interaction.editReply({ embeds: [new EmbedBuilder().setTitle('Informacje o użytkowniku').addFields(info).setColor('Blue')] }).catch(() => {});
      } catch (err) {
        console.error('[ticket] viewinfo error:', err);
        return interaction.editReply({ content: '❌ Błąd podczas pobierania informacji.' }).catch(() => {});
      }
    }

    return interaction.editReply({ content: '❌ Nieznana akcja.' }).catch(() => {});
  });

  // ====== Modal handling for admin warn & giverole ======
  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isModalSubmit()) return;

    const id = interaction.customId;
    if (id.startsWith('modal_warn::')) {
      const channelId = id.split('::')[1];
      const data = await getTicketData(channelId, interaction.guild);
      if (!data) return interaction.reply({ content: '❌ Nie znaleziono danych ticketa.', ephemeral: true }).catch(() => {});
      const reason = interaction.fields.getTextInputValue('warn_reason').trim();
      try {
        const warnedMember = await interaction.guild.members.fetch(data.ownerId).catch(() => null);
        const warnEmbed = new EmbedBuilder()
          .setTitle('⚠️ Ostrzeżenie')
          .setColor('Red')
          .addFields(
            { name: 'Użytkownik', value: warnedMember ? `${warnedMember.user.tag} (<@${data.ownerId}>)` : `<@${data.ownerId}>`, inline: false },
            { name: 'Ostrzeżony przez', value: `<@${interaction.user.id}>`, inline: true },
            { name: 'Kiedy', value: new Date().toLocaleString('pl-PL'), inline: true },
            { name: 'Powód', value: reason || 'Brak podanego powodu', inline: false }
          )
          .setFooter({ text: `Ticket: ${data.ticketNumber ? `#${data.ticketNumber}` : 'brak'} • Serwer: ${interaction.guild.name}` })
          .setTimestamp();

        if (warnedMember) {
          await warnedMember.send({ embeds: [warnEmbed] }).catch(() => {
            console.warn('[ticket] Nie udało się wysłać DM z ostrzeżeniem (użytkownik ma zablokowane DMy).');
          });
        }

        await interaction.reply({ content: `✅ Ostrzeżenie wysłane prywatnie do <@${data.ownerId}>.`, ephemeral: true });

        const logEmbed = new EmbedBuilder()
          .setTitle('Ostrzeżenie — log')
          .setColor('Red')
          .addFields(
            { name: 'Użytkownik', value: data.ownerId ? `<@${data.ownerId}>` : 'brak', inline: true },
            { name: 'Tag', value: warnedMember ? warnedMember.user.tag : 'brak', inline: true },
            { name: 'Ostrzeżony przez', value: `<@${interaction.user.id}>`, inline: true },
            { name: 'Kanał ticketu', value: `<#${channelId}>`, inline: true },
            { name: 'Powód', value: reason || 'Brak podanego powodu', inline: false },
            { name: 'Kiedy', value: new Date().toLocaleString('pl-PL'), inline: true }
          )
          .setTimestamp();

        const reopenBtn = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`log_reopen::${channelId}`).setLabel('Otwórz ponownie ticket').setStyle(ButtonStyle.Primary)
        );

        const lc = await client.channels.fetch(LOG_CHANNEL_ID).catch(() => null);
        if (lc) await lc.send({ embeds: [logEmbed], components: [reopenBtn] }).catch(() => {});

      } catch (err) {
        console.error('[ticket] warn modal error:', err);
        return interaction.reply({ content: '❌ Błąd podczas wysyłania ostrzeżenia.', ephemeral: true }).catch(() => {});
      }
      return;
    }

    if (id.startsWith('modal_giverole::')) {
      const channelId = id.split('::')[1];
      const data = await getTicketData(channelId, interaction.guild);
      if (!data) return interaction.reply({ content: '❌ Nie znaleziono danych ticketa.', ephemeral: true }).catch(() => {});
      const roleId = interaction.fields.getTextInputValue('role_id').trim();
      try {
        const role = interaction.guild.roles.cache.get(roleId) || await interaction.guild.roles.fetch(roleId).catch(() => null);
        if (!role) return interaction.reply({ content: '❌ Nie znaleziono roli o podanym ID.', ephemeral: true }).catch(() => {});
        const memberToModify = await interaction.guild.members.fetch(data.ownerId).catch(() => null);
        if (!memberToModify) return interaction.reply({ content: '❌ Nie znaleziono członka.', ephemeral: true }).catch(() => {});
        await memberToModify.roles.add(role).catch((e) => { throw e; });
        const ch = await client.channels.fetch(channelId).catch(() => null);
        if (ch) await ch.send({ content: `✅ Dodano rolę ${role} użytkownikowi <@${data.ownerId}>.` }).catch(() => {});
        await sendLog('Dodano rolę użytkownikowi', `Rola ${role.name} dodana do <@${data.ownerId}> przez <@${interaction.user.id}>.`, [{ name: 'Kanał', value: `<#${channelId}>` }], 'Green');
        return interaction.reply({ content: `✅ Rola została dodana użytkownikowi <@${data.ownerId}>.`, ephemeral: true }).catch(() => {});
      } catch (err) {
        console.error('[ticket] giverole modal error:', err);
        return interaction.reply({ content: '❌ Nie udało się dodać roli. Sprawdź uprawnienia bota.', ephemeral: true }).catch(() => {});
      }
    }
  });

  // Sprzątanie timeoutów przy zamknięciu procesu
  process.on('exit', () => {
    for (const [, data] of ticketData) {
      if (data?.closeTimeoutId) clearTimeout(data.closeTimeoutId);
      if (data?.closeConfirmTimeoutId) clearTimeout(data.closeConfirmTimeoutId);
    }
  });
};