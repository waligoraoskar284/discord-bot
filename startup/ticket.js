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
  ChannelType
} = require('discord.js');

let ticketNumberCounter = 0;      // numer ticketa wyświetlany w tytule (Ticket #N)
let transactionCounter = 0;       // osobny licznik dla Transaction ID (używany tylko w ZAKUPY)
const ticketData = new Map();     // mapuje channelId -> { ownerId, transactionId, ticketNumber, category, createdAt, closeTimeoutId }

module.exports = (client) => {
  // KONFIGURACJA — zmień ID jeśli trzeba
  const TICKET_CHANNEL_ID = '1312759128627871816';    // kanał z menu do otwierania ticketów
  const ADMIN_ROLE_ID = '1436376487157694586';        // rola administracyjna (ma dostęp do akcji)
  const MOD_BUTTONS_ROLE_ID = '1321051189848047636';  // rola, która może używać przycisków admina
  const TICKETS_CATEGORY_ID = '1313052528761503795';  // kategoria, pod którą tworzą się tickety
  const CLOSED_CATEGORY_ID = '1453095347940491464';   // kategoria, do której przenosimy zamknięte tickety
  const LOG_CHANNEL_ID = '1452581189415338135';       // kanał logów ticketów
  const AUTO_DELETE_AFTER_MS = 10 * 60 * 60 * 1000;   // 10 godzin w ms

  const getEmoji = (id) => client.emojis.cache.get(id)?.toString() || '';

  // Usuwa stare wiadomości bota zawierające menu — pomaga uniknąć interakcji związanych z ephemeral/locked setup
  const deleteOldSetupMessages = async (channel) => {
    try {
      const messages = await channel.messages.fetch({ limit: 200 });
      const botMessages = messages.filter(m =>
        m.author?.id === client.user.id &&
        (m.components?.some(row => row.components?.some(c => c.customId && c.customId.includes('TICKET_MENU'))) ||
         m.embeds?.some(e => e.title && e.title.includes('Wybierz kategorię')))
      );
      for (const [, msg] of botMessages) {
        await msg.delete().catch(() => {});
      }
    } catch (err) {
      console.error('Błąd przy usuwaniu starych wiadomości setup:', err);
    }
  };

  // Wysyła publiczną wiadomość z wyborem kategorii; customId menu zawiera tag 'TICKET_MENU' aby łatwo je znaleźć/usunąć
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
      .setCustomId('TICKET_MENU::ticket_category') // zawiera 'TICKET_MENU' aby można było łatwo odróżnić od innych komponentów
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

  // Wysyła log do kanału LOG_CHANNEL_ID, o ile bot ma dostęp
  const sendLog = async (title, description = '', fields = [], color = 'Blue') => {
    try {
      const logCh = await client.channels.fetch(LOG_CHANNEL_ID).catch(() => null);
      if (!logCh) {
        console.warn('Nie znaleziono kanału logów dla ticketów (LOG_CHANNEL_ID).');
        return;
      }
      const embed = new EmbedBuilder()
        .setTitle(title)
        .setDescription(description || '')
        .setColor(color)
        .setTimestamp();
      if (fields.length) embed.addFields(fields);
      await logCh.send({ embeds: [embed] }).catch(() => {});
    } catch (err) {
      console.error('Błąd przy wysyłaniu loga:', err);
    }
  };

  // READY: usuń stare botowe menu i wyślij publiczne menu
  client.once(Events.ClientReady, async () => {
    try {
      const channel = await client.channels.fetch(TICKET_CHANNEL_ID).catch(() => null);
      if (!channel) {
        console.log('Nie znaleziono kanału ticketowego!');
        return;
      }
      await deleteOldSetupMessages(channel);
      await sendSetupMessage(channel);
      console.log('✅ Publiczny embed ticketowy wysłany!');
    } catch (error) {
      console.error('Błąd przy wysyłaniu embedu ticketowego:', error);
    }
  });

  // /setup komenda (opcjonalna) — wysyła publicznie menu (tylko admin)
  client.on(Events.InteractionCreate, async interaction => {
    if (!interaction.isChatInputCommand()) return;
    if (interaction.commandName !== 'setup') return;

    if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator) &&
      !interaction.member.roles.cache.has(ADMIN_ROLE_ID)) {
      await interaction.reply({ content: '❌ Nie masz uprawnień do uruchomienia tej komendy.', ephemeral: true });
      return;
    }

    try {
      await deleteOldSetupMessages(interaction.channel);
      await sendSetupMessage(interaction.channel);
      await interaction.reply({ content: '✅ Wiadomość z wyborem kategorii została wysłana publicznie na tym kanale.', ephemeral: true });
    } catch (err) {
      console.error('Błąd przy /setup:', err);
      await interaction.reply({ content: '❌ Wystąpił błąd podczas wysyłania wiadomości.', ephemeral: true });
    }
  });

  // Obsługa select menu (TICKET_MENU::ticket_category) — każdy może otworzyć ticket
  client.on(Events.InteractionCreate, async interaction => {
    if (!interaction.isStringSelectMenu()) return;
    if (!interaction.customId.includes('TICKET_MENU::ticket_category')) return;

    const user = interaction.user;
    ticketNumberCounter += 1;

    let modal;
    if (interaction.values[0] === 'inne') {
      modal = new ModalBuilder()
        .setCustomId(`modal_inne::${user.id}::${ticketNumberCounter}`)
        .setTitle('INNE')
        .addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId('opis_problem')
              .setLabel('Opisz problem')
              .setStyle(TextInputStyle.Paragraph)
              .setPlaceholder('Np. Cennik nie działa')
              .setRequired(true)
          )
        );
    } else if (interaction.values[0] === 'zakupy') {
      modal = new ModalBuilder()
        .setCustomId(`modal_zakupy::${user.id}::${ticketNumberCounter}`)
        .setTitle('ZAKUPY')
        .addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId('produkt')
              .setLabel('Co chcesz zakupić?')
              .setStyle(TextInputStyle.Short)
              .setPlaceholder('Np. Sprawdzian/Kartkówka')
              .setRequired(true)
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId('wydawnictwo')
              .setLabel('Wydawnictwo')
              .setStyle(TextInputStyle.Short)
              .setPlaceholder('Np. Nowa Era')
              .setRequired(true)
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId('platnosc')
              .setLabel('Czym będziesz płacił?')
              .setStyle(TextInputStyle.Short)
              .setPlaceholder('Np. Blik, PaySafeCard, inne')
              .setRequired(true)
          )
        );
    }

    if (modal) {
      // pokaż modal
      await interaction.showModal(modal).catch(async (err) => {
        console.error('Błąd przy showModal:', err);
        // jeśli nie udało się pokazać modala — poinformuj użytkownika po polsku
        await interaction.reply({ content: '❌ Nie udało się otworzyć formularza. Spróbuj ponownie.', ephemeral: true }).catch(() => {});
      });
    }
  });

  // Obsługa modal submit -> utwórz ticket
  client.on(Events.InteractionCreate, async interaction => {
    if (!interaction.isModalSubmit()) return;

    const modalId = interaction.customId; // format: modal_zakupy::userId::ticketNumber
    const parts = modalId.split('::');
    if (parts.length < 3) {
      await interaction.reply({ content: '❌ Nieprawidłowy modal.', ephemeral: true });
      return;
    }

    const modalType = parts[0]; // modal_inne or modal_zakupy
    const userIdFromModal = parts[1];
    const ticketNumber = parts[2];

    const user = interaction.user;
    const guild = interaction.guild;

    // Bezpieczeństwo: user musi być tym, który otworzył modal (nie jest to ściśle konieczne, ale pomaga).
    // Jeśli chcesz pominąć tę walidację — można usunąć ten blok.
    if (user.id !== userIdFromModal) {
      await interaction.reply({ content: '❌ Ten formularz nie jest dla Ciebie.', ephemeral: true });
      return;
    }

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
        {
          name: 'Informacje o użytkowniku',
          value:
            `${ePing} Ping: <@${user.id}>\n` +
            `${eTag} TAG: ${user.username}\n` +
            `${eUserId} User ID: ${user.id}`
        },
        { name: 'Opis problemu', value: `> ${opis}` }
      ];
    } else if (modalType === 'modal_zakupy') {
      const produkt = interaction.fields.getTextInputValue('produkt');
      const wydawnictwo = interaction.fields.getTextInputValue('wydawnictwo');
      const platnosc = interaction.fields.getTextInputValue('platnosc');
      category = 'ZAKUPY';
      channelName = `🛒|${user.username}`;

      transactionCounter += 1;
      transactionId = transactionCounter;

      embedFields = [
        {
          name: 'Informacje o użytkowniku',
          value:
            `${ePing} Ping: <@${user.id}>\n` +
            `${eTag} TAG: ${user.username}\n` +
            `${eUserId} User ID: ${user.id} ${eSpacer}`
        },
        {
          name: `${eTrans} Informacje o transakcji`,
          value:
            `${eTrans} Transaction ID: ${transactionId}\n` +
            `${eTrans} Kategoria biletu: ${category}\n` +
            `${eTrans} Produkt: ${produkt}\n` +
            `${eTrans} Wydawnictwo: ${wydawnictwo}\n` +
            `${eTrans} Metoda płatności: ${platnosc}`
        }
      ];
    } else {
      await interaction.reply({ content: '❌ Nieznany typ formularza.', ephemeral: true });
      return;
    }

    // Tworzenie kanału w kategorii ticketów z właściwymi permissionOverwrites:
    // - everyone: brak dostępu
    // - właściciel: zobacz i pisz
    // - admin role: zobacz i pisz
    // - mod buttons role: zobacz i pisz
    let ticketChannel;
    try {
      ticketChannel = await guild.channels.create({
        name: channelName,
        type: ChannelType.GuildText,
        parent: TICKETS_CATEGORY_ID,
        permissionOverwrites: [
          { id: guild.roles.everyone, deny: [PermissionsBitField.Flags.ViewChannel] },
          { id: user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] },
          { id: ADMIN_ROLE_ID, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ManageChannels, PermissionsBitField.Flags.ReadMessageHistory] },
          { id: MOD_BUTTONS_ROLE_ID, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] }
        ]
      });
    } catch (err) {
      console.error('Błąd przy tworzeniu kanału ticketowego:', err);
      await interaction.reply({ content: '❌ Wystąpił błąd podczas tworzenia kanału ticketowego.', ephemeral: true });
      return;
    }

    // Zapisz dane ticketa
    ticketData.set(ticketChannel.id, {
      ownerId: user.id,
      transactionId: transactionId, // null jeśli INNE
      ticketNumber: ticketNumberCounter,
      category,
      createdAt: now.toISOString(),
      closeTimeoutId: null
    });

    // Stopka z datą i godziną
    const ticketEmbed = new EmbedBuilder()
      .setTitle(`Ticket #${ticketNumberCounter} | ${category}`)
      .setColor(category === 'ZAKUPY' ? 'Red' : 'Orange')
      .setFields(embedFields)
      .setThumbnail(user.displayAvatarURL({ dynamic: true, size: 1024 }))
      .setFooter({ text: `Utworzony przez: ${user.tag} • ${createdDateStr}` });

    // Przyciski używają separatora '::' i formatu: <action>::<channelId>
    const buttons = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`close_ticket::${ticketChannel.id}`)
        .setLabel('Zamknij ticket')
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(`admin_panel::${ticketChannel.id}`)
        .setLabel('Panel administracyjny')
        .setStyle(ButtonStyle.Primary)
    );

    // Wysyłamy porządną wiadomość w kanale ticketowym (bez zbędnego "— witaj w Twoim tickecie")
    await ticketChannel.send({ content: `🔔 <@${user.id}> — Twój ticket został utworzony.`, embeds: [ticketEmbed], components: [buttons] }).catch(() => {});

    // Odpowiedz użytkownikowi z linkiem do kanału (ephemeral)
    await interaction.reply({ content: `✅ Twój ticket został otworzony: <#${ticketChannel.id}>`, ephemeral: true });

    // Wyślij log utworzenia ticketa
    const logFields = [
      { name: 'Ticket', value: `#${ticketNumberCounter} | ${category}`, inline: true },
      { name: 'Kanał', value: `<#${ticketChannel.id}>`, inline: true },
      { name: 'Użytkownik', value: `<@${user.id}> (${user.tag})`, inline: false },
      { name: 'Transaction ID', value: transactionId ? String(transactionId) : 'brak', inline: true },
      { name: 'Data utworzenia', value: createdDateStr, inline: true }
    ];
    await sendLog(`Utworzono ticket #${ticketNumberCounter}`, `Utworzono ticket ${ticketNumberCounter} (${category})`, logFields, 'Green');
  });

  // Obsługa kliknięć przycisków (customId format: action::channelId)
  client.on(Events.InteractionCreate, async interaction => {
    if (!interaction.isButton()) return;

    const customId = interaction.customId;
    // akceptujemy dwa formaty: nowy 'action::channelId' oraz (dla kompatybilności) stary z '_' (np. action_channelId)
    let action = null;
    let targetChannelId = null;

    if (customId.includes('::')) {
      const [a, c] = customId.split('::');
      action = a;
      targetChannelId = c;
    } else if (customId.includes('_')) {
      // stary format: join wszystko except first part into channel id
      const parts = customId.split('_');
      action = parts.slice(0, 2).join('_'); // e.g. 'close_ticket' or 'admin_panel'
      targetChannelId = parts.slice(2).join('_');
    } else {
      await interaction.reply({ content: '❌ Nieprawidłowa akcja.', ephemeral: true }).catch(() => {});
      return;
    }

    // jeśli targetChannelId puste — spróbuj użyć aktualnego kanału
    if (!targetChannelId) targetChannelId = interaction.channelId;

    const ticket = ticketData.get(targetChannelId);
    if (!ticket) {
      // Jeśli brak danych ticketa — wyjaśnienie po polsku
      await interaction.reply({ content: '❌ Nie znaleziono danych dla tego ticketa (prawdopodobnie został już zamknięty). Jeśli uważasz, że to błąd, uruchom ponownie /setup aby odświeżyć menu.', ephemeral: true }).catch(() => {});
      return;
    }

    const guild = interaction.guild;
    const member = interaction.member;
    const ownerId = ticket.ownerId;

    const isOwner = member.id === ownerId;
    const canUseAdminButtons = member.roles.cache.has(ADMIN_ROLE_ID) ||
      member.roles.cache.has(MOD_BUTTONS_ROLE_ID) ||
      member.permissions.has(PermissionsBitField.Flags.ManageChannels);

    // Różne akcje:
    if (action === 'close_ticket' || action === 'close') {
      // Zamkniecie: właściciel lub admin/mod
      if (!isOwner && !canUseAdminButtons) {
        await interaction.reply({ content: '❌ Nie masz uprawnień do zamknięcia tego ticketa.', ephemeral: true });
        return;
      }

      // Przenieś kanał do kategorii zamkniętych i zablokuj pisanie właścicielowi,
      // ale pozostaw prawa adminom/modom do pisania
      try {
        const ch = await guild.channels.fetch(targetChannelId).catch(() => null);
        if (!ch) {
          ticketData.delete(targetChannelId);
          await interaction.reply({ content: '✅ Ticket został zamknięty (kanał nie istnieje).', ephemeral: true });
          return;
        }

        // ustawienie uprawnień: everyone - brak view; owner - tylko view (bez send); admin & mod - view+send
        await ch.permissionOverwrites.edit(guild.roles.everyone, { ViewChannel: false }).catch(() => {});
        await ch.permissionOverwrites.edit(ownerId, { ViewChannel: true, SendMessages: false, ReadMessageHistory: true }).catch(() => {});
        await ch.permissionOverwrites.edit(ADMIN_ROLE_ID, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true }).catch(() => {});
        await ch.permissionOverwrites.edit(MOD_BUTTONS_ROLE_ID, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true }).catch(() => {});

        // przenieś do kategorii closed
        await ch.setParent(CLOSED_CATEGORY_ID).catch(() => {});

        // Wyślij wiadomość do kanału i zaplanuj usunięcie
        const deleteAt = new Date(Date.now() + AUTO_DELETE_AFTER_MS);
        const deleteAtStr = deleteAt.toLocaleString('pl-PL', {
          year: 'numeric', month: '2-digit', day: '2-digit',
          hour: '2-digit', minute: '2-digit', second: '2-digit'
        });
        await ch.send({ content: `🔒 Ticket został zamknięty przez <@${interaction.user.id}>. Kanał zostanie usunięty automatycznie ${deleteAtStr} (po 10 godzinach).` }).catch(() => {});

        // zaplanuj usunięcie (uwaga: nie przetrwa restartu bota)
        const timeoutId = setTimeout(async () => {
          try {
            const toDel = await guild.channels.fetch(targetChannelId).catch(() => null);
            if (toDel) await toDel.delete().catch(() => {});
          } catch (err) {
            console.error('Błąd przy automatycznym usuwaniu kanału:', err);
          } finally {
            ticketData.delete(targetChannelId);
            await sendLog(`Usunięto ticket #${ticket.ticketNumber}`, `Automatyczne usunięcie ticketu po zamknięciu.`, [
              { name: 'Ticket', value: `#${ticket.ticketNumber} | ${ticket.category}` },
              { name: 'Kanał', value: `<#${targetChannelId}>` },
              { name: 'Właściciel', value: `<@${ownerId}>` }
            ], 'Grey');
          }
        }, AUTO_DELETE_AFTER_MS);

        // zapisz timeoutId
        const stored = ticketData.get(targetChannelId) || {};
        stored.closeTimeoutId = timeoutId;
        ticketData.set(targetChannelId, stored);

        // log
        await sendLog(`Zamknięto ticket #${ticket.ticketNumber}`, `Ticket został zamknięty przez <@${interaction.user.id}>.`, [
          { name: 'Ticket', value: `#${ticket.ticketNumber} | ${ticket.category}`, inline: true },
          { name: 'Kanał', value: `<#${targetChannelId}>`, inline: true },
          { name: 'Właściciel', value: `<@${ownerId}>`, inline: true },
          { name: 'Zamknięte przez', value: `<@${interaction.user.id}>`, inline: true }
        ], 'Orange');

        await interaction.reply({ content: '✅ Ticket zamknięty. Kanał przeniesiony do archiwum i zostanie usunięty automatycznie za 10 godzin.', ephemeral: true });
      } catch (err) {
        console.error('Błąd przy zamykaniu ticketa:', err);
        await interaction.reply({ content: '❌ Wystąpił błąd podczas zamykania ticketa.', ephemeral: true });
      }
      return;
    }

    if (action === 'admin_panel' || action === 'admin') {
      if (!canUseAdminButtons) {
        await interaction.reply({ content: '❌ Nie masz uprawnień do otwarcia panelu administracyjnego.', ephemeral: true });
        return;
      }

      // pokaż adminowi zestaw przycisków z 5 funkcjami
      const adminEmbed = new EmbedBuilder()
        .setTitle('Panel administracyjny — funkcje')
        .setDescription('Wybierz operację dotyczącą użytkownika, który otworzył ticket.')
        .setColor('Purple')
        .addFields(
          { name: 'Użytkownik ticketa', value: `<@${ownerId}>`, inline: true },
          { name: 'Ticket', value: `#${ticket.ticketNumber} | ${ticket.category}`, inline: true }
        );

      const adminButtons = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`admin_ban::${targetChannelId}`).setLabel('Zbanuj użytkownika').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(`admin_kick::${targetChannelId}`).setLabel('Wyrzuć użytkownika').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(`admin_warn::${targetChannelId}`).setLabel('Ostrzeż użytkownika').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`admin_giverole::${targetChannelId}`).setLabel('Dodaj rolę użytkownikowi').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`admin_force_close::${targetChannelId}`).setLabel('Usuń ticket (siłowo)').setStyle(ButtonStyle.Secondary)
      );

      await interaction.reply({ embeds: [adminEmbed], components: [adminButtons], ephemeral: true });
      return;
    }

    // admin_ban, admin_kick, admin_warn, admin_giverole, admin_force_close, confirm etc.
    // obsługa podobna do wcześniejszych implementacji, ale z użyciem '::' formatu
    switch (action) {
      case 'admin_ban': {
        if (!canUseAdminButtons) {
          await interaction.reply({ content: '❌ Nie masz uprawnień.', ephemeral: true });
          return;
        }
        const confirmRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`confirm_ban_yes::${targetChannelId}`).setLabel('Tak — Zbanuj').setStyle(ButtonStyle.Danger),
          new ButtonBuilder().setCustomId(`confirm_no::${targetChannelId}`).setLabel('Anuluj').setStyle(ButtonStyle.Secondary)
        );
        await interaction.reply({ content: `Potwierdź zbanowanie użytkownika <@${ownerId}>.`, components: [confirmRow], ephemeral: true });
        return;
      }

      case 'confirm_ban_yes': {
        if (!canUseAdminButtons) {
          await interaction.reply({ content: '❌ Nie masz uprawnień.', ephemeral: true });
          return;
        }
        try {
          await guild.members.ban(ownerId, { reason: `Zbanowany z panelu admina — ticket #${ticket.ticketNumber}` });
          await sendLog(`Zbanowano użytkownika z ticketu #${ticket.ticketNumber}`, `Użytkownik <@${ownerId}> został zbanowany przez <@${interaction.user.id}>.`, [
            { name: 'Ticket', value: `#${ticket.ticketNumber}` },
            { name: 'Kanał', value: `<#${targetChannelId}>` }
          ], 'Red');
          await interaction.reply({ content: `✅ Użytkownik <@${ownerId}> został zbanowany.`, ephemeral: true });
        } catch (err) {
          console.error('Błąd przy banowaniu:', err);
          await interaction.reply({ content: '❌ Nie udało się zbanować użytkownika. Sprawdź uprawnienia bota.', ephemeral: true });
        }
        return;
      }

      case 'admin_kick': {
        if (!canUseAdminButtons) {
          await interaction.reply({ content: '❌ Nie masz uprawnień.', ephemeral: true });
          return;
        }
        const confirmRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`confirm_kick_yes::${targetChannelId}`).setLabel('Tak — Wyrzuć').setStyle(ButtonStyle.Danger),
          new ButtonBuilder().setCustomId(`confirm_no::${targetChannelId}`).setLabel('Anuluj').setStyle(ButtonStyle.Secondary)
        );
        await interaction.reply({ content: `Potwierdź wyrzucenie użytkownika <@${ownerId}>.`, components: [confirmRow], ephemeral: true });
        return;
      }

      case 'confirm_kick_yes': {
        if (!canUseAdminButtons) {
          await interaction.reply({ content: '❌ Nie masz uprawnień.', ephemeral: true });
          return;
        }
        try {
          const memberToKick = await guild.members.fetch(ownerId).catch(() => null);
          if (!memberToKick) {
            await interaction.reply({ content: '❌ Nie znaleziono członka do wyrzucenia.', ephemeral: true });
            return;
          }
          await memberToKick.kick(`Wyrzucony z panelu admina — ticket #${ticket.ticketNumber}`);
          await sendLog(`Wyrzucono użytkownika z ticketu #${ticket.ticketNumber}`, `Użytkownik <@${ownerId}> został wyrzucony przez <@${interaction.user.id}>.`, [
            { name: 'Ticket', value: `#${ticket.ticketNumber}` },
            { name: 'Kanał', value: `<#${targetChannelId}>` }
          ], 'Orange');
          await interaction.reply({ content: `✅ Użytkownik <@${ownerId}> został wyrzucony.`, ephemeral: true });
        } catch (err) {
          console.error('Błąd przy kick:', err);
          await interaction.reply({ content: '❌ Nie udało się wyrzucić użytkownika. Sprawdź uprawnienia bota.', ephemeral: true });
        }
        return;
      }

      case 'confirm_no': {
        await interaction.reply({ content: '❌ Anulowano operację.', ephemeral: true });
        return;
      }

      case 'admin_warn': {
        if (!canUseAdminButtons) {
          await interaction.reply({ content: '❌ Nie masz uprawnień.', ephemeral: true });
          return;
        }
        const modal = new ModalBuilder()
          .setCustomId(`modal_warn::${targetChannelId}`)
          .setTitle('Ostrzeż użytkownika')
          .addComponents(
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId('warn_reason')
                .setLabel('Powód ostrzeżenia')
                .setStyle(TextInputStyle.Paragraph)
                .setPlaceholder('Np. spam, łamanie zasad')
                .setRequired(true)
            )
          );
        await interaction.showModal(modal);
        return;
      }

      case 'admin_giverole': {
        if (!canUseAdminButtons) {
          await interaction.reply({ content: '❌ Nie masz uprawnień.', ephemeral: true });
          return;
        }
        const modalRole = new ModalBuilder()
          .setCustomId(`modal_giverole::${targetChannelId}`)
          .setTitle('Dodaj rolę użytkownikowi')
          .addComponents(
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId('role_id')
                .setLabel('ID roli do dodania')
                .setStyle(TextInputStyle.Short)
                .setPlaceholder('Wklej ID roli')
                .setRequired(true)
            )
          );
        await interaction.showModal(modalRole);
        return;
      }

      case 'admin_force_close': {
        if (!canUseAdminButtons) {
          await interaction.reply({ content: '❌ Nie masz uprawnień.', ephemeral: true });
          return;
        }
        try {
          const ch = await guild.channels.fetch(targetChannelId).catch(() => null);
          if (ch) {
            await ch.delete().catch(() => {});
          }
          const stored = ticketData.get(targetChannelId);
          if (stored?.closeTimeoutId) clearTimeout(stored.closeTimeoutId);
          ticketData.delete(targetChannelId);
          await sendLog(`Usunięto ticket #${ticket.ticketNumber}`, `Ticket usunięty siłowo przez <@${interaction.user.id}>.`, [
            { name: 'Ticket', value: `#${ticket.ticketNumber}` },
            { name: 'Właściciel', value: `<@${ownerId}>` }
          ], 'Grey');
          await interaction.reply({ content: '✅ Ticket usunięty siłowo.', ephemeral: true });
        } catch (err) {
          console.error('Błąd przy force close:', err);
          await interaction.reply({ content: '❌ Nie udało się usunąć ticketa.', ephemeral: true });
        }
        return;
      }

      default:
        await interaction.reply({ content: '❌ Nieznana akcja.', ephemeral: true });
        return;
    }
  });

  // Obsługa modali z panelu admina: ostrzeżenie i dodanie roli
  client.on(Events.InteractionCreate, async interaction => {
    if (!interaction.isModalSubmit()) return;

    if (interaction.customId.startsWith('modal_warn::')) {
      const channelId = interaction.customId.split('::')[1];
      const data = ticketData.get(channelId);
      if (!data) {
        await interaction.reply({ content: '❌ Nie znaleziono danych ticketa.', ephemeral: true });
        return;
      }
      const reason = interaction.fields.getTextInputValue('warn_reason');
      const ownerId = data.ownerId;
      const guild = interaction.guild;

      try {
        const memberToWarn = await guild.members.fetch(ownerId).catch(() => null);
        if (memberToWarn) {
          await memberToWarn.send(`Otrzymałeś ostrzeżenie na serwerze ${guild.name}.\nPowód: ${reason}`).catch(() => {});
        }
        const ticketChannel = await guild.channels.fetch(channelId).catch(() => null);
        if (ticketChannel) {
          await ticketChannel.send({ content: `⚠️ Użytkownik <@${ownerId}> został ostrzeżony.\nPowód: ${reason}` }).catch(() => {});
        }
        await sendLog(`Ostrzeżono użytkownika z ticketu #${data.ticketNumber}`, `Ostrzeżenie wysłane przez <@${interaction.user.id}>.`, [
          { name: 'Ticket', value: `#${data.ticketNumber}` },
          { name: 'Użytkownik', value: `<@${ownerId}>` },
          { name: 'Powód', value: reason }
        ], 'Yellow');

        await interaction.reply({ content: `✅ Ostrzeżenie wysłane do <@${ownerId}>.`, ephemeral: true });
      } catch (err) {
        console.error('Błąd przy ostrzeżeniu:', err);
        await interaction.reply({ content: '❌ Wystąpił błąd podczas wysyłania ostrzeżenia.', ephemeral: true });
      }
      return;
    }

    if (interaction.customId.startsWith('modal_giverole::')) {
      const channelId = interaction.customId.split('::')[1];
      const data = ticketData.get(channelId);
      if (!data) {
        await interaction.reply({ content: '❌ Nie znaleziono danych ticketa.', ephemeral: true });
        return;
      }
      const roleId = interaction.fields.getTextInputValue('role_id').trim();
      const guild = interaction.guild;
      const ownerId = data.ownerId;

      try {
        const role = guild.roles.cache.get(roleId) || await guild.roles.fetch(roleId).catch(() => null);
        if (!role) {
          await interaction.reply({ content: '❌ Nie znaleziono roli o podanym ID.', ephemeral: true });
          return;
        }
        const memberToModify = await guild.members.fetch(ownerId).catch(() => null);
        if (!memberToModify) {
          await interaction.reply({ content: '❌ Nie znaleziono członka.', ephemeral: true });
          return;
        }
        await memberToModify.roles.add(role).catch(err => { throw err; });
        const ticketChannel = await guild.channels.fetch(channelId).catch(() => null);
        if (ticketChannel) {
          await ticketChannel.send({ content: `✅ Dodano rolę ${role} użytkownikowi <@${ownerId}>.` }).catch(() => {});
        }
        await sendLog(`Dodano rolę użytkownikowi z ticketu #${data.ticketNumber}`, `Rola ${role.name} została dodana do <@${ownerId}> przez <@${interaction.user.id}>.`, [
          { name: 'Ticket', value: `#${data.ticketNumber}` },
          { name: 'Rola', value: `${role.name} (${role.id})` }
        ], 'Green');
        await interaction.reply({ content: `✅ Rola została dodana użytkownikowi <@${ownerId}>.`, ephemeral: true });
      } catch (err) {
        console.error('Błąd przy dodawaniu roli:', err);
        await interaction.reply({ content: '❌ Nie udało się dodać roli. Sprawdź uprawnienia bota.', ephemeral: true });
      }
      return;
    }
  });

  // cleanup timeouty przy zamykaniu procesu
  process.on('exit', () => {
    for (const [, data] of ticketData) {
      if (data?.closeTimeoutId) clearTimeout(data.closeTimeoutId);
    }
  });

  // pomocnicza rada: jeśli nadal widzisz angielski błąd "Only the person who initiated the setup...",
  // to znaczy, że w kanale nadal znajduje się stara ephemeral/locked wiadomość z komponentami.
  // Uruchom /setup jako administrator (komenda w tym pliku), lub usuń ręcznie tę starą wiadomość.
};