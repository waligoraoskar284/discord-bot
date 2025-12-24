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

let ticketNumberCounter = 0; // używane tylko do unik. customId w modalach
let transactionCounter = 0; // sekwencyjne ID transakcji (1,2,3,...)
const ticketData = new Map(); // channelId -> { ownerId, transactionId, ticketNumber, category, createdAt, closeTimeoutId, closeConfirmTimeoutId }

// Przechowuje ostatnią wysłaną wiadomość setup przez bota i jej token
let lastSetup = { messageId: null, token: null };

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

  // helper: generuj token dla menu setup (krótki, bezpieczny)
  const generateSetupToken = () => `${Date.now().toString(36)}-${Math.floor(Math.random() * 10000).toString(36)}`;

  // helper: zwraca kolejny, prosty transaction id (1,2,3,...)
  const nextTransactionId = () => {
    transactionCounter += 1;
    return transactionCounter;
  };

  // --- Helpers ---
  const sendLog = async (title, description = '', fields = [], color = 'Blue', components = []) => {
    try {
      const logCh = await client.channels.fetch(LOG_CHANNEL_ID).catch(() => null);
      if (!logCh) return;
      const embed = new EmbedBuilder()
        .setTitle(title)
        .setDescription(description || '')
        .setColor(color)
        .setTimestamp()
        .setFooter({ text: `System ticketów` })
        .setAuthor({ name: client.user ? client.user.username : 'Bot', iconURL: client.user ? client.user.displayAvatarURL() : undefined });

      if (fields.length) embed.addFields(fields);
      await logCh.send({ embeds: [embed], components }).catch(() => {});
    } catch (err) {
      console.error('[ticket] Błąd przy wysyłaniu loga:', err);
    }
  };

  // Usuwa WIADOMOŚCI zawierające menu ticketowe lub embed "Wybierz kategorię".
  // Jeśli podano keepMessageId, nie usuwaj tej wiadomości (to nowa botowa).
  const deleteOldSetupMessages = async (channel, keepMessageId = null) => {
    try {
      const messages = await channel.messages.fetch({ limit: 200 }).catch(() => null);
      if (!messages) return;
      const toRemove = messages.filter((m) => {
        if (keepMessageId && m.id === keepMessageId) return false;
        const hasTicketComponent = m.components?.some((row) =>
          row.components?.some((c) => typeof c.customId === 'string' && c.customId.includes('TICKET_MENU::ticket_category'))
        );
        const hasTicketEmbed = m.embeds?.some((e) => typeof e.title === 'string' && e.title.includes('Wybierz kategorię'));
        return hasTicketComponent || hasTicketEmbed;
      });
      for (const [, msg] of toRemove) {
        await msg.delete().catch(() => {});
      }
    } catch (err) {
      console.error('[ticket] Błąd przy usuwaniu starych wiadomości setup:', err);
    }
  };

  // Wyślij botowe menu setup z unikalnym tokenem w customId i zapisz referencję.
  const sendSetupMessage = async (channel) => {
    const token = generateSetupToken();
    const embed = new EmbedBuilder()
      .setTitle('💡 Wybierz kategorię')
      .setDescription(
        `${getEmoji('1452715580456042647')} Potrzebujesz pomocy lub kontaktu innego niż zakup? Wybierz kategorię **INNE**\n` +
        `${getEmoji('1453054774172975124')} Interesuje Cię zakup? Wybierz kategorię **ZAKUPY**`
      )
      .setColor('Blue')
      .setImage('https://cdn.discordapp.com/attachments/1312840154070777889/1453012826334695455/logo_spr.png')
      .setFooter({ text: 'Kliknij w menu, aby otworzyć ticket' });

    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId(`TICKET_MENU::ticket_category::${token}`)
      .setPlaceholder('💡 Wybierz kategorię ticketa...')
      .addOptions([
        { label: 'INNE', description: 'Problemy niezwiązane z zakupem', value: 'inne', emoji: { id: '1452715580456042647' } },
        { label: 'ZAKUPY', description: 'Zakup sprawdzianu/kartkówki', value: 'zakupy', emoji: { id: '1453054774172975124' } }
      ])
      .setMinValues(1)
      .setMaxValues(1);

    const row = new ActionRowBuilder().addComponents(selectMenu);
    const sent = await channel.send({ embeds: [embed], components: [row] }).catch(() => null);
    if (sent) {
      // zapisz token i id nowej wiadomości
      lastSetup = { messageId: sent.id, token };
      // usuń stare wiadomości, ale zostaw tę nową
      await deleteOldSetupMessages(channel, sent.id);
    }
    return sent;
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
        if (ownerId) await ch.permissionOverwrites.edit(ownerId, { ViewChannel: false, SendMessages: false, ReadMessageHistory: true }).catch(() => {});
        if (ADMIN_ROLE_ID) await ch.permissionOverwrites.edit(ADMIN_ROLE_ID, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true }).catch(() => {});
        if (MOD_BUTTONS_ROLE_ID) await ch.permissionOverwrites.edit(MOD_BUTTONS_ROLE_ID, { ViewChannel: true, SendMessages: false, ReadMessageHistory: true }).catch(() => {});
      } catch (errPerm) {
        console.error('[ticket] Błąd przy edycji nadpisań uprawnień:', errPerm);
      }

      await ch.setParent(CLOSED_CATEGORY_ID).catch(() => {});

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

      const fields = [
        { name: 'Kanał', value: `<#${channelId}>` },
        { name: 'Zamknięte przez', value: `<@${closedByUserId}>` },
        { name: 'Właściciel', value: ticket.ownerId ? `<@${ticket.ownerId}>` : 'brak' },
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

  // --- Ready / setup message ---
  client.once(Events.ClientReady, async () => {
    try {
      const ch = await client.channels.fetch(TICKET_CHANNEL_ID).catch(() => null);
      if (!ch) return console.log('[ticket] Nie znaleziono kanału ticketowego');
      // usuń wszystkie stare wiadomości setup i wyślij nową botową
      await deleteOldSetupMessages(ch, null);
      await sendSetupMessage(ch);
      // periodic cleaner co 5 minut (zachowujemy jedną botową wiadomość)
      setInterval(async () => {
        const chLoop = await client.channels.fetch(TICKET_CHANNEL_ID).catch(() => null);
        if (!chLoop) return;
        await deleteOldSetupMessages(chLoop, lastSetup.messageId);
        // upewnij się, że jest przynajmniej jedna botowa wiadomość z menu
        const fetched = await chLoop.messages.fetch({ limit: 50 }).catch(() => null);
        const hasBotMenu = fetched && fetched.some(m =>
          m.author?.id === client.user.id &&
          m.components?.some((row) => row.components?.some((c) => typeof c.customId === 'string' && c.customId.includes('TICKET_MENU::ticket_category')))
        );
        if (!hasBotMenu) await sendSetupMessage(chLoop).catch(() => {});
      }, 5 * 60 * 1000);
      console.log('[ticket] Menu ticketowe wysłane i cleaner uruchomiony.');
    } catch (err) {
      console.error('[ticket] Ready error:', err);
    }
  });

  // --- Select menu -> show modal (i sprawdzenie czy user ma już ticket w tej kategorii) ---
  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isStringSelectMenu()) return;
    // spodziewany format: TICKET_MENU::ticket_category::<token>
    if (!interaction.customId?.startsWith('TICKET_MENU::ticket_category::')) return;

    // Parsuj token z customId
    const parts = interaction.customId.split('::');
    const token = parts[2] || null;

    try {
      // Jeśli token nie zgadza się z ostatnim tokenem bota => to stara/obca wiadomość.
      if (!token || token !== lastSetup.token) {
        // Wysłanie tylko informacji po polsku i przerwanie obsługi - bez usuwania embedu/menu
        try {
          if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({
              ephemeral: true,
              content: '❗ Ta wiadomość setup jest nieaktualna. Odśwież menu.'
            });
          }
        } catch (e) {
          try { await interaction.deferReply({ ephemeral: true }).catch(() => {}); } catch (e2) { /* ignore */ }
        }
        return;
      }
    } catch (err) {
      console.error('[ticket] Handling foreign/old setup menu error:', err);
    }

    const user = interaction.user;
    const guild = interaction.guild;
    const selected = interaction.values[0]; // 'inne' lub 'zakupy'
    const wantedCategory = selected === 'zakupy' ? 'ZAKUPY' : 'INNE';

    const existingCh = userHasOpenTicketInCategory(guild, user.id, wantedCategory);
    if (existingCh) {
      await interaction.reply({ content: `❌ Masz już otwarty ticket w tej kategorii: <#${existingCh.id}>. Nie możesz otworzyć kolejnego.`, ephemeral: true });
      return;
    }

    ticketNumberCounter += 1;
    const currentTicketNumber = ticketNumberCounter; // używane tylko w customId modala

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

  // --- Modal submit -> create ticket channel ---
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

    // Emoji dla nagłówków
    const emojiUserHeader = getEmoji('1453068281979076691') || '';
    const emojiTransHeader = getEmoji('1452715580456042647') || '';
    const eTransLine = getEmoji('1453070829285019658') || '';

    let category, channelName, embedFields = [], transactionId = null;

    if (modalType === 'modal_inne') {
      const opis = interaction.fields.getTextInputValue('opis_problem');
      category = 'INNE';
      channelName = `❓|${user.username}`;

      embedFields = [
        { name: `${emojiUserHeader} **__Informacje o użytkowniku:__**`, value: `${getEmoji('1452951976785481741') || ''} Ping: <@${user.id}>\n${getEmoji('1452712183589900298') || ''} TAG: ${user.tag}\n${getEmoji('1452715580456042647') || ''} ID użytkownika: ${user.id}` },
        { name: `🔎 **__Opis problemu:__**`, value: `> ${opis}` }
      ];
    } else {
      const produkt = interaction.fields.getTextInputValue('produkt');
      const wydawnictwo = interaction.fields.getTextInputValue('wydawnictwo');
      const platnosc = interaction.fields.getTextInputValue('platnosc');
      category = 'ZAKUPY';
      channelName = `🛒|${user.username}`;

      // generujemy sekwencyjne transactionId (1,2,3,...)
      transactionId = nextTransactionId();

      embedFields = [
        { name: `${emojiUserHeader} **__Informacje o użytkowniku:__**`, value: `${getEmoji('1452951976785481741') || ''} Ping: <@${user.id}>\n${getEmoji('1452712183589900298') || ''} TAG: ${user.tag}\n${getEmoji('1452715580456042647') || ''} ID użytkownika: ${user.id}` },
        {
          name: `${emojiTransHeader} **__Informacje o transakcji:__**`,
          value:
            `${eTransLine} Transaction ID: ${transactionId}\n` +
            `${eTransLine} Kategoria: ${category}\n` +
            `${eTransLine} Produkt: ${produkt}\n` +
            `${eTransLine} Wydawnictwo: ${wydawnictwo}\n` +
            `${eTransLine} Metoda płatności: ${platnosc}`
        }
      ];
    }

    // final safe-check
    const existingCh = userHasOpenTicketInCategory(interaction.guild, user.id, category);
    if (existingCh) {
      await interaction.reply({ content: `❌ Masz już otwarty ticket w tej kategorii: <#${existingCh.id}>. Nie możesz otworzyć kolejnego.`, ephemeral: true });
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
          { id: user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] },
          { id: ADMIN_ROLE_ID, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ManageChannels, PermissionsBitField.Flags.ReadMessageHistory] },
          // MOD role: DENY viewing open tickets
          { id: MOD_BUTTONS_ROLE_ID, deny: [PermissionsBitField.Flags.ViewChannel] }
        ]
      });
    } catch (err) {
      console.error('[ticket] Błąd przy tworzeniu kanału:', err);
      await interaction.reply({ content: '❌ Wystąpił błąd podczas tworzenia kanału ticketowego.', ephemeral: true });
      return;
    }

    // Zapisz dane ticketa (transactionId jeśli jest)
    ticketData.set(ticketChannel.id, {
      ownerId: user.id,
      transactionId,
      ticketNumber: null, // usuwamy użycie numeru ticketu w UI, ale trzymamy pole na wypadek migracji
      category,
      createdAt: now.toISOString(),
      closeTimeoutId: null,
      closeConfirmTimeoutId: null
    });

    // Embed - usuwamy "Numer ticketu" z tytułu/ pól; zostawiamy tylko Transaction ID w polach (jeśli istnieje)
    const title = `Ticket | ${category}`;
    const ticketEmbed = new EmbedBuilder()
      .setTitle(title)
      .setColor(category === 'ZAKUPY' ? 'Red' : 'Orange')
      .addFields(embedFields)
      .setThumbnail(user.displayAvatarURL({ dynamic: true, size: 1024 }))
      .setFooter({ text: `Utworzony przez: ${user.tag} • ${createdDateStr}` })
      .setTimestamp();

    const buttons = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`close_ticket::${ticketChannel.id}`).setLabel('Zamknij ticket').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(`admin_panel::${ticketChannel.id}`).setLabel('Panel administracyjny').setStyle(ButtonStyle.Primary)
    );

    // Wyślij wiadomość do kanału ticketowego — ping użytkownika i embed
    await ticketChannel.send({ content: `🔔 <@${user.id}>`, embeds: [ticketEmbed], components: [buttons] }).catch(() => {});

    // Odpowiedz autorowi
    await interaction.reply({ content: `✅ Twój ticket został utworzony: <#${ticketChannel.id}>`, ephemeral: true });

    // Wyślij log (rozszerzony) - używamy tylko Transaction ID, usuwamy Numer ticketu
    await sendLog('Utworzono ticket', `Utworzono ticket (${category})`, [
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
    let [action, channelId] = customId.includes('::') ? customId.split('::') : [null, null];
    if (!action || !channelId) {
      const parts = customId.split('_');
      if (parts.length >= 3) {
        action = parts.slice(0, 2).join('_');
        channelId = parts.slice(2).join('_');
      }
    }
    if (!action) {
      try { await interaction.reply({ content: '❌ Nieprawidłowa akcja.', ephemeral: true }); } catch {}
      return;
    }
    if (!channelId) channelId = interaction.channelId;

    // Nie deferujemy dla akcji które otwierają modal (bo showModal nie działa po defer)
    const actionsThatShowModal = new Set(['admin_warn', 'admin_giverole']);
    let didDefer = false;
    if (!actionsThatShowModal.has(action)) {
      try {
        await interaction.deferReply({ ephemeral: true });
        didDefer = true;
      } catch (e) {
        // ignore
      }
    }

    // SPECIAL: log_reopen - może odnosić się do kanału, nawet jeśli ticketData nie istnieje
    if (action === 'log_reopen') {
      if (!interaction.member.roles.cache.has(ADMIN_ROLE_ID) && !interaction.member.roles.cache.has(MOD_BUTTONS_ROLE_ID) && !interaction.member.permissions.has(PermissionsBitField.Flags.ManageChannels)) {
        return (didDefer ? interaction.editReply({ content: '❌ Nie masz uprawnień do ponownego otwarcia tego ticketa.' }) : interaction.reply({ content: '❌ Nie masz uprawnień do ponownego otwarcia tego ticketa.', ephemeral: true })).catch(() => {});
      }
      const ch = await client.channels.fetch(channelId).catch(() => null);
      if (!ch) {
        return (didDefer ? interaction.editReply({ content: '❌ Nie znaleziono kanału (być może został usunięty).' }) : interaction.reply({ content: '❌ Nie znaleziono kanału (być może został usunięty).', ephemeral: true })).catch(() => {});
      }

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
          { name: 'Właściciel', value: stored.ownerId ? `<@${stored.ownerId}>` : 'brak' },
          { name: 'Transaction ID', value: stored.transactionId ? String(stored.transactionId) : 'brak' }
        ], 'Green');

        return (didDefer ? interaction.editReply({ content: `✅ Ticket <#${channelId}> został przywrócony i otwarty ponownie.` }) : interaction.reply({ content: `✅ Ticket <#${channelId}> został przywrócony i otwarty ponownie.`, ephemeral: true })).catch(() => {});
      } catch (err) {
        console.error('[ticket] log_reopen error:', err);
        return (didDefer ? interaction.editReply({ content: '❌ Wystąpił błąd podczas otwierania ticketu.' }) : interaction.reply({ content: '❌ Wystąpił błąd podczas otwierania ticketu.', ephemeral: true })).catch(() => {});
      }
    }

    // Pobierz lub odbuduj ticket data
    const data = await getTicketData(channelId, interaction.guild);
    if (!data) {
      return (didDefer ? interaction.editReply({ content: '❌ Nie znaleziono danych dla tego ticketa (prawdopodobnie został już zamknięty).' }) : interaction.reply({ content: '❌ Nie znaleziono danych dla tego ticketa (prawdopodobnie został już zamknięty).', ephemeral: true })).catch(() => {});
    }

    const ownerId = data.ownerId;
    const member = interaction.member;
    const isOwner = member.id === ownerId;
    const canUseAdminButtons = member.roles.cache.has(ADMIN_ROLE_ID) || member.roles.cache.has(MOD_BUTTONS_ROLE_ID) || member.permissions.has(PermissionsBitField.Flags.ManageChannels);

    // --- Zamknięcie - potwierdzenie z 5s odliczeniem ---
    if (action === 'close_ticket' || action === 'close') {
      if (!isOwner && !canUseAdminButtons) {
        return (didDefer ? interaction.editReply({ content: '❌ Nie masz uprawnień do zamknięcia tego ticketa.' }) : interaction.reply({ content: '❌ Nie masz uprawnień do zamknięcia tego ticketa.', ephemeral: true })).catch(() => {});
      }

      if (data.closeConfirmTimeoutId) {
        return (didDefer ? interaction.editReply({ content: '✅ Zamknięcie już zaplanowane. Możesz je anulować.' }) : interaction.reply({ content: '✅ Zamknięcie już zaplanowane. Możesz je anulować.', ephemeral: true })).catch(() => {});
      }

      const confirmRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`confirm_close::${channelId}`).setLabel('Zamknij teraz').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(`cancel_close::${channelId}`).setLabel('Anuluj').setStyle(ButtonStyle.Secondary)
      );

      // Wyświetl ephemeral tylko klikającemu (nie publicznie)
      if (didDefer) {
        await interaction.editReply({ content: `🔔 Zamknięcie ticketu za 5 sekund (tylko widoczne dla Ciebie).`, components: [confirmRow] }).catch(() => {});
      } else {
        await interaction.reply({ content: `🔔 Zamknięcie ticketu za 5 sekund (tylko widoczne dla Ciebie).`, components: [confirmRow], ephemeral: true }).catch(() => {});
      }

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

    // Anulowanie zamknięcia
    if (action === 'cancel_close') {
      if (!data.closeConfirmTimeoutId) {
        return (didDefer ? interaction.editReply({ content: '❌ Brak zaplanowanego zamknięcia.' }) : interaction.reply({ content: '❌ Brak zaplanowanego zamknięcia.', ephemeral: true })).catch(() => {});
      }
      clearTimeout(data.closeConfirmTimeoutId);
      data.closeConfirmTimeoutId = null;
      ticketData.set(channelId, data);
      try {
        await sendLog('Anulowano zamknięcie', `Zamknięcie ticketu anulowane przez <@${interaction.user.id}>.`, [
          { name: 'Kanał', value: `<#${channelId}>` },
          { name: 'Anulował', value: `<@${interaction.user.id}>` }
        ], 'Grey');
      } catch (e) {}
      return (didDefer ? interaction.editReply({ content: '❌ Zamknięcie zostało anulowane.' }) : interaction.reply({ content: '❌ Zamknięcie zostało anulowane.', ephemeral: true })).catch(() => {});
    }

    if (action === 'confirm_close') {
      if (!isOwner && !canUseAdminButtons) {
        return (didDefer ? interaction.editReply({ content: '❌ Nie masz uprawnień.' }) : interaction.reply({ content: '❌ Nie masz uprawnień.', ephemeral: true })).catch(() => {});
      }
      if (data.closeConfirmTimeoutId) {
        clearTimeout(data.closeConfirmTimeoutId);
        data.closeConfirmTimeoutId = null;
      }
      await performClose(channelId, interaction.user.id);
      return (didDefer ? interaction.editReply({ content: '✅ Ticket został zamknięty natychmiast.' }) : interaction.reply({ content: '✅ Ticket został zamknięty natychmiast.', ephemeral: true })).catch(() => {});
    }

    // --- Panel administracyjny (podmenu i akcje) ---
    if (action === 'admin_panel' || action === 'admin') {
      if (!canUseAdminButtons) {
        return (didDefer ? interaction.editReply({ content: '❌ Nie masz uprawnień do otwarcia panelu administracyjnego.' }) : interaction.reply({ content: '❌ Nie masz uprawnień do otwarcia panelu administracyjnego.', ephemeral: true })).catch(() => {});
      }

      const ownerTag = (await interaction.guild.members.fetch(ownerId).then(m => m.user.tag).catch(() => 'brak')) || 'brak';
      const created = data.createdAt ? new Date(data.createdAt).toLocaleString('pl-PL') : 'brak';

      const adminFields = [
        { name: 'Użytkownik ticketa', value: ownerId ? `<@${ownerId}>` : 'brak', inline: true },
        { name: 'Tag', value: ownerTag, inline: true },
        { name: 'ID użytkownika', value: ownerId ? ownerId : 'brak', inline: true },
        { name: 'Kanał', value: `<#${channelId}>`, inline: true },
        { name: 'Nazwa kanału', value: (await client.channels.fetch(channelId).then(c => c.name).catch(() => 'brak')), inline: true },
        { name: 'Kategoria', value: data.category || 'brak', inline: true },
        { name: 'Transaction ID', value: data.transactionId ? String(data.transactionId) : 'brak', inline: true },
        { name: 'Utworzono', value: created, inline: false }
      ];

      const adminMainEmbed = new EmbedBuilder()
        .setTitle('Panel administracyjny — funkcje')
        .setDescription('Wybierz operację dotyczącą użytkownika, który otworzył ticket.')
        .setColor('Purple')
        .addFields(adminFields);

      const adminMainButtons = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`admin_moderation::${channelId}`).setLabel('Moderacja (ban/kick/warn)').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(`admin_roles::${channelId}`).setLabel('Role / Informacje').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`admin_ticketmanage::${channelId}`).setLabel('Zarządzanie ticketem').setStyle(ButtonStyle.Secondary)
      );

      return (didDefer ? interaction.editReply({ embeds: [adminMainEmbed], components: [adminMainButtons] }) : interaction.reply({ embeds: [adminMainEmbed], components: [adminMainButtons], ephemeral: true })).catch(() => {});
    }

    // Pozostałe sekcje (admin_moderation, admin_roles, admin_ticketmanage, admin_* actions)
    // - zachowują poprzednią logikę (nie zmieniane tutaj).
    return (didDefer ? interaction.editReply({ content: '❌ Nieznana akcja.' }) : interaction.reply({ content: '❌ Nieznana akcja.', ephemeral: true })).catch(() => {});
  });

  // --- Modal handling for admin warn & giverole ---
  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isModalSubmit()) return;

    const id = interaction.customId;
    if (id.startsWith('modal_warn::')) {
      const channelId = id.split('::')[1];
      const data = await getTicketData(channelId, interaction.guild);
      if (!data) {
        return interaction.reply({ content: '❌ Nie znaleziono danych ticketa.', ephemeral: true }).catch(() => {});
      }
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
          .setFooter({ text: `Transaction ID: ${data.transactionId ? String(data.transactionId) : 'brak'} • Serwer: ${interaction.guild.name}` })
          .setTimestamp();

        if (warnedMember) {
          await warnedMember.send({ embeds: [warnEmbed] }).catch(() => {
            console.warn('[ticket] Nie udało się wysłać DM z ostrzeżeniem (użytkownik ma zablokowane DMy).');
          });
        }

        await interaction.reply({ content: `✅ Ostrzeżenie wysłane prywatnie do <@${data.ownerId}>.`, ephemeral: true });

        // Wyślij rozszerzony log do kanału LOG_CHANNEL_ID (embed + przycisk)
        const logEmbed = new EmbedBuilder()
          .setTitle('Ostrzeżenie — log')
          .setColor('Red')
          .addFields(
            { name: 'Użytkownik', value: data.ownerId ? `<@${data.ownerId}>` : 'brak', inline: true },
            { name: 'Tag', value: warnedMember ? warnedMember.user.tag : 'brak', inline: true },
            { name: 'Ostrzeżony przez', value: `<@${interaction.user.id}>`, inline: true },
            { name: 'Kanał ticketu', value: `<#${channelId}>`, inline: true },
            { name: 'Transaction ID', value: data.transactionId ? String(data.transactionId) : 'brak', inline: true },
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
      if (!data) {
        return interaction.reply({ content: '❌ Nie znaleziono danych ticketa.', ephemeral: true }).catch(() => {});
      }
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