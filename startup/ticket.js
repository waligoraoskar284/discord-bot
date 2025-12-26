/**
 * Skrypt ticketów (polski) - poprawki:
 * - Rolę MOD_BUTTONS_ROLE_ID (1321051189848047636) widzi tylko zamknięte tickety.
 * - Naprawa "trzeba klikać dwa razy": wszystkie przyciski deferrują odpowiedź natychmiast
 *
 * Dodatkowo: ujednolicono i wzmocniono wysyłanie logów do LOG_CHANNEL_ID
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
  // Ustawione TICKET_CHANNEL_ID na żądany kanał 1454069542283120642
  const TICKET_CHANNEL_ID = '1454069542283120642'; // kanał z embedem wyboru kategorii (zmieniono na wymagany)
  const ADMIN_ROLE_ID = '1436376487157694586';
  const MOD_BUTTONS_ROLE_ID = '1321051189848047636';
  const TICKETS_CATEGORY_ID = '1313052528761503795';
  const CLOSED_CATEGORY_ID = '1453095347940491464';
  const LOG_CHANNEL_ID = '1454069542283120642'; // <-- docelowy kanał logów (ten sam co TICKET)
  const AUTO_DELETE_AFTER_MS = 10 * 60 * 60 * 1000; // 10 godzin

  const getEmoji = (id) => client.emojis.cache.get(id)?.toString() || '';

  // --- Helpers ---
  /**
   * sendLog - ujednolicone wysyłanie logów do LOG_CHANNEL_ID
   * Przyjmuje albo pola (title, description, fields, color, components)
   * lub opcjonalny gotowy embed w parametrze embedOverride.
   */
  const sendLog = async (title, description = '', fields = [], color = 'Blue', components = [], embedOverride = null) => {
    try {
      const logCh = await client.channels.fetch(LOG_CHANNEL_ID).catch(() => null);
      if (!logCh) {
        console.warn(`[ticket] Nie znaleziono kanału logów o ID ${LOG_CHANNEL_ID}. Nie wysłano logu: ${title}`);
        return;
      }

      // Upewnij się, że kanał nadaje się do wysyłania wiadomości
      if (typeof logCh.send !== 'function') {
        console.warn(`[ticket] Kanał logów (${LOG_CHANNEL_ID}) nie obsługuje wysyłania wiadomości.`);
        return;
      }

      const embed = embedOverride || new EmbedBuilder()
        .setTitle(title)
        .setDescription(description || '')
        .setColor(color)
        .setTimestamp();

      if (!embedOverride && fields.length) {
        try {
          embed.addFields(fields);
        } catch (e) {
          console.warn('[ticket] Nie udało się dodać pól do embeda logu:', e);
        }
      }

      await logCh.send({ embeds: [embed], components }).catch((err) => {
        console.error('[ticket] Błąd przy wysyłaniu loga na kanał logów:', err);
      });
    } catch (err) {
      console.error('[ticket] Błąd w sendLog:', err);
    }
  };

  const deleteOldSetupMessages = async (channel) => {
    try {
      if (!channel || typeof channel.messages?.fetch !== 'function') return;
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
    try {
      if (!channel || typeof channel.send !== 'function') {
        console.warn(`[ticket] Nie można wysłać setup message - kanał (${channel?.id}) nie jest obsługiwalny przez .send`);
        return null;
      }

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
      return await channel.send({ embeds: [embed], components: [row] });
    } catch (err) {
      console.error('[ticket] Błąd przy wysyłaniu setup message:', err);
      return null;
    }
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

  // Sprawdź czy user ma już otwarty ticket w danej kategorii (skanujemy istniejące kanały w kategorii ticketów)
  const userHasOpenTicketInCategory = (guild, userId, wantedCategory) => {
    const channels = guild.channels.cache.filter(ch => ch.type === ChannelType.GuildText && ch.parentId === TICKETS_CATEGORY_ID);
    for (const [, ch] of channels) {
      const ow = ch.permissionOverwrites.cache.get(userId);
      if (!ow) continue;
      try {
        if (ow.allow?.has(PermissionsBitField.Flags.SendMessages)) {
          const cat = ch.name.startsWith('🛒') ? 'ZAKUPY' : ch.name.startsWith('❓') ? 'INNE' : null;
          if (cat === wantedCategory) return ch; // zwróć kanał
        }
      } catch (e) { /* ignore */ }
    }
    return null;
  };

  // Wykonaj zamknięcie ticketa (przeniesienie do CLOSED_CATEGORY_ID, zablokowanie widoku dla ownera, ustawienie widoku dla MOD role)
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
        // właściciel nie widzi kanału w archiwum
        if (ownerId) await ch.permissionOverwrites.edit(ownerId, { ViewChannel: false, SendMessages: false, ReadMessageHistory: true }).catch(() => {});
        // ADMIN zawsze widzi i może pisać
        if (ADMIN_ROLE_ID) await ch.permissionOverwrites.edit(ADMIN_ROLE_ID, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true }).catch(() => {});
        // MOD role ma zobaczyć tylko zamknięte tickety: dajemy ViewChannel: true, SendMessages: false
        if (MOD_BUTTONS_ROLE_ID) await ch.permissionOverwrites.edit(MOD_BUTTONS_ROLE_ID, { ViewChannel: true, SendMessages: false, ReadMessageHistory: true }).catch(() => {});
      } catch (errPerm) {
        console.error('[ticket] Błąd przy edycji nadpisań uprawnień:', errPerm);
      }

      await ch.setParent(CLOSED_CATEGORY_ID).catch(() => {});
      await ch.send({ content: `🔒 Ticket został przeniesiony do archiwum przez <@${closedByUserId}>.\n⏳ Kanał zostanie automatycznie usunięty za 10 godzin.` }).catch(() => {});

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

      // Rozszerzony log przy zamknięciu z przyciskiem do ponownego otwarcia
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

  // --- Ready / setup message ---
  client.once(Events.ClientReady, async () => {
    try {
      const ch = await client.channels.fetch(TICKET_CHANNEL_ID).catch(() => null);
      if (!ch) {
        console.error(`[ticket] Nie znaleziono kanału ticketowego o ID ${TICKET_CHANNEL_ID}. Sprawdź czy ID jest poprawne i czy bot jest na serwerze.`);
        return;
      }

      // Sprawdź czy możemy wysłać wiadomości
      if (typeof ch.send !== 'function') {
        console.error(`[ticket] Kanał ${TICKET_CHANNEL_ID} nie obsługuje wysyłania wiadomości przez bota (typ kanału nieobsługiwany).`);
        return;
      }

      // Opcjonalnie: sprawdź uprawnienia bota w tym kanale (jeśli channel.permissionsFor działa)
      try {
        const perms = ch.permissionsFor?.(client.user);
        if (perms && !perms.has(PermissionsBitField.Flags.SendMessages)) {
          console.warn(`[ticket] Bot nie ma uprawnienia SendMessages na kanale ${TICKET_CHANNEL_ID}. Menu nie zostanie wysłane.`);
        }
      } catch (e) {
        // ignoruj
      }

      // Wyślij panel tylko raz podczas ready
      await deleteOldSetupMessages(ch);
      const sent = await sendSetupMessage(ch);
      if (sent) console.log('[ticket] Menu ticketowe wysłane.');
      else console.warn('[ticket] Nie udało się wysłać menu ticketowego (sendSetupMessage zwróciło null).');
    } catch (err) {
      console.error('[ticket] Ready error:', err);
    }
  });

  // --- Select menu -> show modal (i sprawdzenie czy user ma już ticket w tej kategorii) ---
  // Zmiana: usunięto walidację "only setupUser" -> każdy może klikać w menu.
  // Używamy dokładnego porównania customId === 'TICKET_MENU::ticket_category'
  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isStringSelectMenu()) return;
    if (interaction.customId !== 'TICKET_MENU::ticket_category') return;

    const user = interaction.user;
    const guild = interaction.guild;
    const selected = interaction.values[0]; // 'inne' lub 'zakupy'
    const wantedCategory = selected === 'zakupy' ? 'ZAKUPY' : 'INNE';

    // Sprawdź czy user ma już otwarty ticket w tej kategorii
    const existingCh = userHasOpenTicketInCategory(guild, user.id, wantedCategory);
    if (existingCh) {
      // natychmiastowy ephemeral feedback
      try {
        return await interaction.reply({ content: `❌ Masz już otwarty ticket w tej kategorii: <#${existingCh.id}>. Nie możesz otworzyć kolejnego.`, ephemeral: true });
      } catch (err) {
        console.error('[ticket] Błąd przy odpowiadaniu na istniejący ticket:', err);
        return;
      }
    }

    // Jeśli dany wybór wymaga dodatkowych pól -> pokaż modal (showModal musi być pierwszą odpowiedzią)
    // NIE wolno deferReply przed showModal
    if (selected === 'inne') {
      const currentTicketNumber = ++ticketNumberCounter;
      const modal = new ModalBuilder()
        .setCustomId(`modal_inne::${user.id}::${currentTicketNumber}`)
        .setTitle('INNE')
        .addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('opis_problem').setLabel('Opisz problem').setStyle(TextInputStyle.Paragraph).setRequired(true)
          )
        );
      try {
        return await interaction.showModal(modal);
      } catch (err) {
        console.error('[ticket] showModal(inne) error:', err);
        // fallback: jeśli showModal zawiedzie, powiadamiamy użytkownika ephemeral
        try { await interaction.reply({ content: '❌ Nie udało się otworzyć formularza. Spróbuj ponownie.', ephemeral: true }); } catch (e) {}
        return;
      }
    }

    if (selected === 'zakupy') {
      const currentTicketNumber = ++ticketNumberCounter;
      const modal = new ModalBuilder()
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
      try {
        return await interaction.showModal(modal);
      } catch (err) {
        console.error('[ticket] showModal(zakupy) error:', err);
        try { await interaction.reply({ content: '❌ Nie udało się otworzyć formularza. Spróbuj ponownie.', ephemeral: true }); } catch (e) {}
        return;
      }
    }

    // Jeśli kiedykolwiek dodasz opcję, która NIE wymaga modala,
    // tutaj możesz użyć deferReply/editReply (aby zapobiec double-click):
    // try { await interaction.deferReply({ ephemeral: true }); } catch(e){ }
    // ...utwórz ticket bez modala...
    // await interaction.editReply({ content: '✅ Twój ticket został utworzony.' });

    return;
  });

  // --- Modal submit -> create ticket channel ---
  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isModalSubmit()) return;

    const parts = interaction.customId.split('::'); // [modal_type, userId, ticketNumber]
    if (parts.length < 3) return;
    const modalType = parts[0];
    const userIdFromModal = parts[1];
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
    const eSpacer = getEmoji('1452712355002585330') || '';
    const eTrans = getEmoji('1453070829285019658') || ''; // przywrócone emoji dla transakcji

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
        { name: `${eTrans} Informacje o transakcji`, value: `ID transakcji: ${transactionId}\nKategoria: ${category}\nProdukt: ${produkt}\nWydawnictwo: ${wydawnictwo}\nMetoda płatności: ${platnosc}` }
      ];
    }

    // final safe-check
    const existingCh = userHasOpenTicketInCategory(interaction.guild, user.id, category);
    if (existingCh) {
      try {
        await interaction.reply({ content: `❌ Masz już otwarty ticket w tej kategorii: <#${existingCh.id}>. Nie możesz otworzyć kolejnego.`, ephemeral: true });
      } catch (err) {
        console.error('[ticket] Błąd przy reply istniejącego ticketu w modalSubmit:', err);
      }
      return;
    }

    // Tworzenie kanału - UWAGA: MOD role nie widzi otwartych ticketów (deny ViewChannel)
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
      try { await interaction.reply({ content: '❌ Wystąpił błąd podczas tworzenia kanału ticketowego.', ephemeral: true }); } catch(e) {}
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
      new ButtonBuilder().setCustomId(`close_ticket::${ticketChannel.id}`).setLabel('Zamknij ticket').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(`admin_panel::${ticketChannel.id}`).setLabel('Panel administracyjny').setStyle(ButtonStyle.Primary)
    );

    // Wyślij wiadomość do kanału ticketowego — tylko ping użytkownika i embed
    await ticketChannel.send({ content: `🔔 <@${user.id}>`, embeds: [ticketEmbed], components: [buttons] }).catch(() => {});

    // Odpowiedz autorowi (modal submit pozwala na normalny reply)
    try {
      await interaction.reply({ content: `✅ Twój ticket został utworzony: <#${ticketChannel.id}>`, ephemeral: true });
    } catch (err) {
      console.error('[ticket] Błąd przy reply po utworzeniu ticketa:', err);
    }

    // Wyślij log (rozszerzony)
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

    // Deferruj każdy przycisk natychmiast, żeby uniknąć NEEDS_RESPONSE i konieczności "klikania dwa razy"
    try {
      await interaction.deferReply({ ephemeral: true });
    } catch (e) {
      // jeśli już zostało zdeferrowane lub nie można - ignoruj
    }

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
      return interaction.editReply({ content: '❌ Nieprawidłowa akcja.' }).catch(() => {});
    }
    if (!channelId) channelId = interaction.channelId;

    // SPECIAL: log_reopen - może odnosić się do kanału, nawet jeśli ticketData nie istnieje
    if (action === 'log_reopen') {
      if (!interaction.member.roles.cache.has(ADMIN_ROLE_ID) && !interaction.member.roles.cache.has(MOD_BUTTONS_ROLE_ID) && !interaction.member.permissions.has(PermissionsBitField.Flags.ManageChannels)) {
        return interaction.editReply({ content: '❌ Nie masz uprawnień do ponownego otwarcia tego ticketa.' }).catch(() => {});
      }
      const ch = await client.channels.fetch(channelId).catch(() => null);
      if (!ch) {
        return interaction.editReply({ content: '❌ Nie znaleziono kanału (być może został usunięty).' }).catch(() => {});
      }

      try {
        await ch.setParent(TICKETS_CATEGORY_ID).catch(() => {});
        let stored = ticketData.get(channelId);
        if (!stored) stored = await rebuildTicketDataFromChannel(ch) || { ownerId: null, transactionId: null, ticketNumber: null, category: null, createdAt: new Date().toISOString(), closeTimeoutId: null, closeConfirmTimeoutId: null };

        // przywróć pisanie dla właściciela (jeśli istnieje)
        if (stored.ownerId) {
          await ch.permissionOverwrites.edit(stored.ownerId, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true }).catch(() => {});
        }

        // MOD role nie widzi otwartych ticketów -> deny ViewChannel
        if (MOD_BUTTONS_ROLE_ID) await ch.permissionOverwrites.edit(MOD_BUTTONS_ROLE_ID, { ViewChannel: false }).catch(() => {});

        // anuluj zaplanowane usunięcie jeśli istnieje
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
        return interaction.editReply({ content: '❌ Wystąpił błąd podczas otwierania ticketu.' }).catch(() => {});
      }
    }

    // Pobierz lub odbuduj ticket data
    const data = await getTicketData(channelId, interaction.guild);
    if (!data) {
      return interaction.editReply({ content: '❌ Nie znaleziono danych dla tego ticketa (prawdopodobnie został już zamknięty).' }).catch(() => {});
    }

    const ownerId = data.ownerId;
    const member = interaction.member;
    const isOwner = member.id === ownerId;
    const canUseAdminButtons = member.roles.cache.has(ADMIN_ROLE_ID) || member.roles.cache.has(MOD_BUTTONS_ROLE_ID) || member.permissions.has(PermissionsBitField.Flags.ManageChannels);

    // --- Zamknięcie - potwierdzenie z 5s odliczeniem ---
    if (action === 'close_ticket' || action === 'close') {
      if (!isOwner && !canUseAdminButtons) {
        return interaction.editReply({ content: '❌ Nie masz uprawnień do zamknięcia tego ticketa.' }).catch(() => {});
      }

      if (data.closeConfirmTimeoutId) {
        return interaction.editReply({ content: '✅ Zamknięcie już zaplanowane. Możesz je anulować.' }).catch(() => {});
      }

      const confirmRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`confirm_close::${channelId}`).setLabel('Zamknij teraz').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(`cancel_close::${channelId}`).setLabel('Anuluj').setStyle(ButtonStyle.Secondary)
      );

      // Ephemeral dla klikającego, i krótka wiadomość w kanale
      await interaction.editReply({ content: `🔔 Ticket zamknie się w przeciągu 5 sekund. Dziękujemy!`, components: [confirmRow] }).catch(() => {});
      try {
        const ch = await client.channels.fetch(channelId).catch(() => null);
        if (ch) await ch.send({ content: `🔔 Ticket zamknie się w przeciągu 5 sekund. Dziękujemy!` }).catch(() => {});
      } catch (e) { /* ignore */ }

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

    // ... (reszta akcji admina / warn / giverole / itp. pozostaje bez zmian) ...
    return interaction.editReply({ content: '❌ Nieznana akcja.' }).catch(() => {});
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
          .setFooter({ text: `Ticket: ${data.ticketNumber ? `#${data.ticketNumber}` : 'brak'} • Serwer: ${interaction.guild.name}` })
          .setTimestamp();

        if (warnedMember) {
          await warnedMember.send({ embeds: [warnEmbed] }).catch(() => {
            console.warn('[ticket] Nie udało się wysłać DM z ostrzeżeniem (użytkownik ma zablokowane DMy).');
          });
        }

        await interaction.reply({ content: `✅ Ostrzeżenie wysłane prywatnie do <@${data.ownerId}>.`, ephemeral: true });

        // Wyślij rozszerzony log do kanału LOG_CHANNEL_ID (embed + przycisk) - teraz używamy sendLog
        const fields = [
          { name: 'Użytkownik', value: data.ownerId ? `<@${data.ownerId}>` : 'brak', inline: true },
          { name: 'Tag', value: warnedMember ? warnedMember.user.tag : 'brak', inline: true },
          { name: 'Ostrzeżony przez', value: `<@${interaction.user.id}>`, inline: true },
          { name: 'Kanał ticketu', value: `<#${channelId}>`, inline: true },
          { name: 'Powód', value: reason || 'Brak podanego powodu', inline: false },
          { name: 'Kiedy', value: new Date().toLocaleString('pl-PL'), inline: true }
        ];

        const reopenBtn = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`log_reopen::${channelId}`).setLabel('Otwórz ponownie ticket').setStyle(ButtonStyle.Primary)
        );

        await sendLog('Ostrzeżenie — log', '', fields, 'Red', [reopenBtn], warnEmbed);

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