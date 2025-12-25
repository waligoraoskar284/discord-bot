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
const ticketData = new Map();

// przechowujemy tylko id wiadomości ostatniego setupu
let lastSetup = { messageId: null };

module.exports = (client) => {
  const TICKET_CHANNEL_ID = '1312759128627871816';
  const MOD_BUTTONS_ROLE_ID = '1321051189848047636';
  const TICKETS_CATEGORY_ID = '1313052528761503795';
  const CLOSED_CATEGORY_ID = '1453095347940491464';
  const LOG_CHANNEL_ID = '1452581189415338135';
  const AUTO_DELETE_AFTER_MS = 10 * 60 * 60 * 1000;

  // Ustaw tu ADMIN_ROLE_ID jeśli masz
  const ADMIN_ROLE_ID = null;

  const getEmoji = (id) => client.emojis.cache.get(id)?.toString() || '';

  const nextTransactionId = () => {
    transactionCounter += 1;
    return transactionCounter;
  };

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

  const isSetupMessage = (m) => {
    try {
      if (!m) return false;
      if (!m.author || m.author.id !== client.user?.id) return false;
      const hasTicketComponent = m.components?.some((row) =>
        row.components?.some((c) => typeof c.customId === 'string' && c.customId === 'TICKET_MENU::ticket_category')
      );
      const hasTicketEmbed = m.embeds?.some((e) => typeof e.title === 'string' && e.title.includes('Wybierz kategorię'));
      return Boolean(hasTicketComponent || hasTicketEmbed);
    } catch (e) {
      return false;
    }
  };

  const parseTokenFromMessage = (msg) => {
    // nazwa funkcji pozostawiona dla kompatybilności - teraz zwraca boolean czy to nasze menu
    try {
      if (!msg || !msg.components) return null;
      for (const row of msg.components) {
        for (const comp of row.components) {
          if (comp?.customId && comp.customId === 'TICKET_MENU::ticket_category') {
            return true;
          }
        }
      }
    } catch (e) { /* ignore */ }
    return null;
  };

  // Usuwa tylko nasze stare wiadomości setup (wywoływane TYLKO przy starcie / deploy)
  const cleanSetupMessages = async (channel) => {
    try {
      if (!channel || !channel.messages) return;
      let lastId = undefined;
      do {
        const fetched = await channel.messages.fetch({ limit: 100, before: lastId }).catch(() => null);
        if (!fetched || fetched.size === 0) break;
        for (const msg of fetched.values()) {
          if (isSetupMessage(msg)) {
            await msg.delete().catch(() => {});
          }
        }
        lastId = fetched.last() ? fetched.last().id : undefined;
      } while (lastId);
    } catch (err) {
      console.error('[ticket] cleanSetupMessages error:', err);
    }
  };

  const sendSetupMessage = async (channel) => {
    // nie generujemy tokena - używamy stałego customId żeby wiadomość była "stabilna" między restartami
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
      .setCustomId(`TICKET_MENU::ticket_category`) // STAŁE customId
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
      lastSetup = { messageId: sent.id };
      const fetched = await channel.messages.fetch({ limit: 200 }).catch(() => null);
      if (fetched) {
        const toRemove = fetched.filter(m => isSetupMessage(m) && m.id !== sent.id);
        for (const [, msg] of toRemove) { await msg.delete().catch(() => {}); }
      }
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

  // --- Ready / setup message (TYLKO TUTAJ czyścimy + wysyłamy jedną wiadomość) ---
  client.once(Events.ClientReady, async () => {
    try {
      const ch = await client.channels.fetch(TICKET_CHANNEL_ID).catch(() => null);
      if (!ch) return console.log('[ticket] Nie znaleziono kanału ticketowego');

      // przy starcie usuwamy WSZYSTKIE nasze stare wiadomości setup i wysyłamy JEDNĄ nową
      await cleanSetupMessages(ch);
      const newMsg = await sendSetupMessage(ch);
      if (newMsg) {
        lastSetup = { messageId: newMsg.id };
      }

      console.log('[ticket] Menu ticketowe wysłane (raz) po starcie.');
    } catch (err) {
      console.error('[ticket] Ready error:', err);
    }
  });

  // --- Select menu: NIE USUWAMY/ODŚWIEŻAMY WIADOMOŚCI tutaj (tylko akceptujemy jeśli to nasza wiadomość) ---
  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isStringSelectMenu()) return;
    if (!interaction.customId?.startsWith('TICKET_MENU::ticket_category')) return;

    // Jeżeli komponent NIE pochodzi od naszego bota -> tylko informujemy i kończymy
    if (interaction.message?.author?.id !== client.user?.id) {
      try {
        await interaction.reply({ content: '❗ Ten przycisk nie pochodzi z aktualnego menu. Skontaktuj się z administracją.', flags: 64 });
      } catch (e) { /* ignore */ }
      return;
    }

    // synchronizacja local state id wiadomości (przydatne po restarcie)
    try {
      const isOurMenu = parseTokenFromMessage(interaction.message);
      if (isOurMenu) lastSetup = { messageId: interaction.message.id };
    } catch (e) { /* ignore */ }

    // normalna obsługa wyboru kategorii (OTWIERAMY modal bez żadnego usuwania/odświeżania wiadomości z menu)
    const user = interaction.user;
    const guild = interaction.guild;
    const selected = interaction.values[0]; // 'inne' lub 'zakupy'
    const wantedCategory = selected === 'zakupy' ? 'ZAKUPY' : 'INNE';

    const existingCh = userHasOpenTicketInCategory(guild, user.id, wantedCategory);
    if (existingCh) {
      try { await interaction.reply({ content: `❌ Masz już otwarty ticket w tej kategorii: <#${existingCh.id}>.`, flags: 64 }); } catch {}
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

    // showModal musi być wywołane bez defer
    await interaction.showModal(modal).catch(async (err) => {
      console.error('[ticket] showModal error:', err);
      try { await interaction.reply({ content: '❌ Nie udało się otworzyć formularza. Spróbuj ponownie.', flags: 64 }); } catch {}
    });
  });

  // --- Modal submit -> tworzymy ticket (NIE DOTYKAMY WIADOMOŚCI SETUP) ---
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

    const existingCh = userHasOpenTicketInCategory(interaction.guild, user.id, category);
    if (existingCh) {
      try { await interaction.reply({ content: `❌ Masz już otwarty ticket w tej kategorii: <#${existingCh.id}>.`, flags: 64 }); } catch {}
      return;
    }

    let ticketChannel;
    try {
      const permOverwrites = [
        { id: interaction.guild.roles.everyone, deny: [PermissionsBitField.Flags.ViewChannel] },
        { id: user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] },
      ];
      if (ADMIN_ROLE_ID) {
        permOverwrites.push({ id: ADMIN_ROLE_ID, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ManageChannels, PermissionsBitField.Flags.ReadMessageHistory] });
      }
      if (MOD_BUTTONS_ROLE_ID) {
        permOverwrites.push({ id: MOD_BUTTONS_ROLE_ID, deny: [PermissionsBitField.Flags.ViewChannel] });
      }

      ticketChannel = await interaction.guild.channels.create({
        name: channelName,
        type: ChannelType.GuildText,
        parent: TICKETS_CATEGORY_ID,
        permissionOverwrites: permOverwrites
      });
    } catch (err) {
      console.error('[ticket] Błąd przy tworzeniu kanału:', err);
      try { await interaction.reply({ content: '❌ Wystąpił błąd podczas tworzenia kanału ticketowego.', flags: 64 }); } catch {}
      return;
    }

    ticketData.set(ticketChannel.id, {
      ownerId: user.id,
      transactionId,
      ticketNumber: null,
      category,
      createdAt: now.toISOString(),
      closeTimeoutId: null,
      closeConfirmTimeoutId: null
    });

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

    await ticketChannel.send({ content: `🔔 <@${user.id}>`, embeds: [ticketEmbed], components: [buttons] }).catch(() => {});
    try { await interaction.reply({ content: `✅ Twój ticket został utworzony: <#${ticketChannel.id}>`, flags: 64 }); } catch {}

    await sendLog('Utworzono ticket', `Utworzono ticket (${category})`, [
      { name: 'Kanał', value: `<#${ticketChannel.id}>` },
      { name: 'Użytkownik', value: `<@${user.id}> (${user.tag})` },
      { name: 'Transaction ID', value: transactionId ? String(transactionId) : 'brak' },
      { name: 'Data utworzenia', value: createdDateStr }
    ], 'Green');
  });

  process.on('exit', () => {
    for (const [, data] of ticketData) {
      if (data?.closeTimeoutId) clearTimeout(data.closeTimeoutId);
      if (data?.closeConfirmTimeoutId) clearTimeout(data.closeConfirmTimeoutId);
    }
  });
};