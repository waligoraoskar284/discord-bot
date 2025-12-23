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
const ticketData = new Map();     // mapuje channelId -> { ownerId, transactionId, ticketNumber, category, closeTimeoutId }

module.exports = (client) => {
  // Konfiguracja — zmień ID jeśli potrzeba
  const TICKET_CHANNEL_ID = '1312759128627871816';    // kanał, gdzie bot wysyła embed do wybierania kategorii
  const ADMIN_ROLE_ID = '1436376487157694586';        // rola administracyjna
  const MOD_BUTTONS_ROLE_ID = '1321051189848047636';  // rola, która może używać przycisków admina
  const TICKETS_CATEGORY_ID = '1313052528761503795';  // kategoria, pod którą tworzą się tickety
  const CLOSED_CATEGORY_ID = '1453095347940491464';   // kategoria, do której przenosimy zamknięte tickety
  const LOG_CHANNEL_ID = '1452581189415338135';       // kanał, gdzie zapisywane są logi ticketów
  const AUTO_DELETE_AFTER_MS = 10 * 60 * 60 * 1000;   // 10 godzin w ms

  const getEmoji = (id) => client.emojis.cache.get(id)?.toString() || '';

  // Usuń stare wiadomości botowe z menu ticketowego (żeby uniknąć "Only the person..." blokad)
  const deleteOldSetupMessages = async (channel) => {
    try {
      const messages = await channel.messages.fetch({ limit: 200 });
      const botMessages = messages.filter(m =>
        m.author?.id === client.user.id &&
        (m.components?.some(row => row.components?.some(c => c.customId === 'ticket_category')) ||
         m.embeds?.some(e => e.title && e.title.includes('Wybierz kategorię')))
      );
      for (const [, msg] of botMessages) {
        await msg.delete().catch(() => {});
      }
    } catch (err) {
      console.error('Błąd przy usuwaniu starych wiadomości setup:', err);
    }
  };

  // Wyślij publiczną wiadomość z wyborem kategorii
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
      .setCustomId('ticket_category')
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

  // Wyślij log do kanału LOG_CHANNEL_ID (jeśli istnieje)
  const sendLog = async (client, title, description, fields = [], color = 'Blue') => {
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
      console.error('Błąd przy wysyłaniu loga:', err);
    }
  };

  // Ready: usuń stare i wyślij menu
  client.once(Events.ClientReady, async () => {
    try {
      const channel = await client.channels.fetch(TICKET_CHANNEL_ID);
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

  // Opcjonalna komenda /setup — wysyła publicznie wiadomość (tylko admin)
  client.on(Events.InteractionCreate, async interaction => {
    if (!interaction.isChatInputCommand()) return;
    if (interaction.commandName !== 'setup') return;

    if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator) &&
      !interaction.member.roles.cache.has(ADMIN_ROLE_ID)) {
      await interaction.reply({ content: '❌ Nie masz uprawnień do uruchomienia tej komendy.', ephemeral: true });
      return;
    }

    try {
      const channel = interaction.channel;
      await deleteOldSetupMessages(channel);
      await sendSetupMessage(channel);
      await interaction.reply({ content: '✅ Wiadomość z wyborem kategorii została wysłana publicznie na tym kanale.', ephemeral: true });
    } catch (err) {
      console.error('Błąd przy /setup:', err);
      await interaction.reply({ content: '❌ Wystąpił błąd podczas wysyłania wiadomości.', ephemeral: true });
    }
  });

  // Wybór kategorii -> pokaż modal (KAŻDY może)
  client.on(Events.InteractionCreate, async interaction => {
    if (!interaction.isStringSelectMenu()) return;
    if (interaction.customId !== 'ticket_category') return;

    const user = interaction.user;
    ticketNumberCounter += 1;

    let modal;
    if (interaction.values[0] === 'inne') {
      modal = new ModalBuilder()
        .setCustomId(`modal_inne_${user.id}_${ticketNumberCounter}`)
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
        .setCustomId(`modal_zakupy_${user.id}_${ticketNumberCounter}`)
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

    if (modal) await interaction.showModal(modal);
  });

  // Obsługa modali -> tworzenie ticketa
  client.on(Events.InteractionCreate, async interaction => {
    if (!interaction.isModalSubmit()) return;

    const user = interaction.user;
    const guild = interaction.guild;

    const ePing = getEmoji('1453068281979076691');
    const eTag = getEmoji('1452951976785481741');
    const eUserId = getEmoji('1452715580456042647');
    const eSpacer = getEmoji('1452712355002585330');
    const eTrans = getEmoji('1453070829285019658');

    let category, channelName, embedFields = [], transactionId = null, ticketNumber = null;

    // Data i godzina utworzenia (lokalny string)
    const now = new Date();
    const createdDateStr = now.toLocaleString('pl-PL', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    });

    if (interaction.customId.startsWith('modal_inne')) {
      const opis = interaction.fields.getTextInputValue('opis_problem');
      category = 'INNE';
      channelName = `❓|${user.username}`;
      ticketNumber = ticketNumberCounter;

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

    } else if (interaction.customId.startsWith('modal_zakupy')) {
      const produkt = interaction.fields.getTextInputValue('produkt');
      const wydawnictwo = interaction.fields.getTextInputValue('wydawnictwo');
      const platnosc = interaction.fields.getTextInputValue('platnosc');
      category = 'ZAKUPY';
      channelName = `🛒|${user.username}`;
      ticketNumber = ticketNumberCounter;

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
      await interaction.reply({ content: '❌ Nieznany modal.', ephemeral: true });
      return;
    }

    // Tworzenie kanału w kategorii TICKETS_CATEGORY_ID z odpowiednimi uprawnieniami
    let ticketChannel;
    try {
      ticketChannel = await guild.channels.create({
        name: channelName,
        type: ChannelType.GuildText,
        parent: TICKETS_CATEGORY_ID,
        permissionOverwrites: [
          { id: guild.roles.everyone, deny: [PermissionsBitField.Flags.ViewChannel] },
          { id: user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] },
          { id: ADMIN_ROLE_ID, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ManageChannels, PermissionsBitField.Flags.ReadMessageHistory] }
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
      ticketNumber: ticketNumber,
      category,
      createdAt: now.toISOString(),
      closeTimeoutId: null
    });

    // Embed w kanale ticketowym z datą i godziną w stopce
    const ticketEmbed = new EmbedBuilder()
      .setTitle(`Ticket #${ticketNumber} | ${category}`)
      .setColor(category === 'ZAKUPY' ? 'Red' : 'Orange')
      .setFields(embedFields)
      .setThumbnail(user.displayAvatarURL({ dynamic: true, size: 1024 }))
      .setFooter({ text: `Utworzony przez: ${user.tag} • ${createdDateStr}` });

    // Przyciski: zwróć uwagę, że customIdy admin panelu zawierają ID kanału aby akcje były jednoznaczne
    const buttons = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`close_ticket_${ticketChannel.id}`)
        .setLabel('Zamknij ticket')
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(`admin_panel_${ticketChannel.id}`)
        .setLabel('Panel administracyjny')
        .setStyle(ButtonStyle.Primary)
    );

    await ticketChannel.send({ content: `<@${user.id}> — witaj w Twoim tickecie`, embeds: [ticketEmbed], components: [buttons] });

    // Odpowiedz użytkownikowi, wskaż kanał ticketa (polski komunikat)
    await interaction.reply({ content: `✅ Twój ticket został otworzony: <#${ticketChannel.id}>`, ephemeral: true });

    // Wyślij log utworzenia do kanału logów
    const logFields = [
      { name: 'Ticket', value: `#${ticketNumber} | ${category}`, inline: true },
      { name: 'Kanał', value: `<#${ticketChannel.id}>`, inline: true },
      { name: 'Użytkownik', value: `<@${user.id}> (${user.tag})`, inline: false },
      { name: 'Transaction ID', value: transactionId ? String(transactionId) : 'brak', inline: true },
      { name: 'Data utworzenia', value: createdDateStr, inline: true }
    ];
    await sendLog(client, `Utworzono ticket #${ticketNumber}`, `Utworzono ticket ${ticketNumber} (${category})`, logFields, 'Green');
  });

  // Obsługa kliknięć przycisków (close_ticket_xxx, admin_panel_xxx, i akcje admina)
  client.on(Events.InteractionCreate, async interaction => {
    if (!interaction.isButton()) return;

    const guild = interaction.guild;
    const member = interaction.member;
    const customId = interaction.customId;

    // Przyciski powinny zawierać channelId jako sufiks: <action>_<channelId>
    const [action, channelId] = customId.split('_', 2);
    if (!channelId) {
      // Nieprawidłowy customId — ignorujemy
      await interaction.reply({ content: '❌ Nieprawidłowa akcja.', ephemeral: true }).catch(() => {});
      return;
    }

    const ticket = ticketData.get(channelId);
    if (!ticket) {
      // Jeśli brak danych ticketa — nie pokazujemy starego komunikatu.
      // Odpowiemy krótko i dyskretnie (ephemeral) — bez komunikatu "To nie jest kanał ticketowy..."
      await interaction.reply({ content: '❌ Brak danych ticketa (prawdopodobnie ticket został już zamknięty).', ephemeral: true }).catch(() => {});
      return;
    }

    const ownerId = ticket.ownerId;

    // sprawdź uprawnienia do akcji admina: ADMIN_ROLE_ID lub MOD_BUTTONS_ROLE_ID lub ManageChannels
    const canUseAdminButtons = member.roles.cache.has(ADMIN_ROLE_ID) ||
      member.roles.cache.has(MOD_BUTTONS_ROLE_ID) ||
      member.permissions.has(PermissionsBitField.Flags.ManageChannels);

    // ZAMKNIJ TICKETA
    if (action === 'close') {
      // customId może być 'close_ticket' or 'close_ticket_<channelId>' depending how .split worked
      // our format is close_ticket_<channelId> -> action='close', channelId='ticket_<channelId>' so handle properly:
      // adjust parsing: if action === 'close' then second part is 'ticket', and we need third part; handle robustly:
    }

    // Robust parsing: reconstruct parts
    const parts = customId.split('_');
    // possible forms:
    // - close_ticket_<channelId>  => parts[0]=close, [1]=ticket, [2]=<channelId>
    // - admin_panel_<channelId>   => parts[0]=admin, [1]=panel, [2]=<channelId>
    // we handle generically:
    const baseAction = parts.slice(0, 2).join('_'); // e.g., 'close_ticket' or 'admin_panel' or 'admin_ban'...
    const targetChannelId = parts.slice(2).join('_'); // join the rest as channel id (in case)
    // If there is no targetChannelId, fallback to previously parsed channelId variable
    const targetId = targetChannelId || channelId;

    // Now route by baseAction:
    switch (baseAction) {
      case 'close_ticket': {
        // kto może zamknąć? właściciel lub osoby z uprawnieniami admin/mod
        if (member.id !== ownerId && !canUseAdminButtons) {
          await interaction.reply({ content: '❌ Nie masz uprawnień do zamknięcia tego ticketa.', ephemeral: true });
          return;
        }
        try {
          const ch = await guild.channels.fetch(targetId).catch(() => null);
          if (!ch) {
            ticketData.delete(targetId);
            await interaction.reply({ content: '✅ Ticket został zamknięty (kanał nie istnieje).', ephemeral: true });
            return;
          }

          // Przenieś kanał do kategorii CLOSED_CATEGORY_ID i ustaw, żeby właściciel nie mógł pisać
          await ch.setParent(CLOSED_CATEGORY_ID).catch(() => {});
          await ch.permissionOverwrites.edit(ownerId, { SendMessages: false }).catch(() => {});
          // Wyślij wiadomość do kanału informując, że ticket zamknięto i będzie usunięty za X godzin
          const deleteAt = new Date(Date.now() + AUTO_DELETE_AFTER_MS);
          const deleteAtStr = deleteAt.toLocaleString('pl-PL', {
            year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit', second: '2-digit'
          });
          await ch.send({ content: `🔒 Ticket został zamknięty przez <@${interaction.user.id}>. Kanał zostanie usunięty automatycznie ${deleteAtStr} (po 10 godzinach).` }).catch(() => {});

          // Zaplanuj usunięcie po 10 godzinach (uwaga: zniknie po restarcie bota)
          const timeoutId = setTimeout(async () => {
            try {
              const toDel = await guild.channels.fetch(targetId).catch(() => null);
              if (toDel) await toDel.delete().catch(() => {});
            } catch (err) {
              console.error('Błąd przy automatycznym usuwaniu kanału:', err);
            } finally {
              ticketData.delete(targetId);
              // Log
              await sendLog(client, `Usunięto ticket #${ticket.ticketNumber}`, `Automatyczne usunięcie ticketu po zamknięciu.`, [
                { name: 'Ticket', value: `#${ticket.ticketNumber} | ${ticket.category}` },
                { name: 'Kanał', value: `<#${targetId}>` },
                { name: 'Właściciel', value: `<@${ownerId}>` }
              ], 'Grey');
            }
          }, AUTO_DELETE_AFTER_MS);

          // Zapisz timeout id żeby móc anulować (np. w force close)
          const stored = ticketData.get(targetId) || {};
          stored.closeTimeoutId = timeoutId;
          ticketData.set(targetId, stored);

          // Log zamknięcia
          await sendLog(client, `Zamknięto ticket #${ticket.ticketNumber}`, `Ticket został zamknięty przez <@${interaction.user.id}>.`, [
            { name: 'Ticket', value: `#${ticket.ticketNumber} | ${ticket.category}`, inline: true },
            { name: 'Kanał', value: `<#${targetId}>`, inline: true },
            { name: 'Właściciel', value: `<@${ownerId}>`, inline: true },
            { name: 'Zamknięte przez', value: `<@${interaction.user.id}>`, inline: true }
          ], 'Orange');

          await interaction.reply({ content: `✅ Ticket zamknięty. Kanał przeniesiony do archiwum i zostanie usunięty automatycznie za 10 godzin.`, ephemeral: true });
        } catch (err) {
          console.error('Błąd przy zamykaniu ticketa:', err);
          await interaction.reply({ content: '❌ Wystąpił błąd podczas zamykania ticketa.', ephemeral: true });
        }
        return;
      }

      case 'admin_panel': {
        // tylko uprawnieni
        if (!canUseAdminButtons) {
          await interaction.reply({ content: '❌ Nie masz uprawnień do otwarcia panelu administracyjnego.', ephemeral: true });
          return;
        }

        // Pokaż adminowi zestaw przycisków z 5 funkcjami — każdy z customId zawiera channelId
        const adminEmbed = new EmbedBuilder()
          .setTitle('Panel administracyjny — funkcje')
          .setDescription('Wybierz operację dotyczącą użytkownika, który otworzył ticket.')
          .setColor('Purple')
          .addFields(
            { name: 'Użytkownik ticketa', value: `<@${ownerId}>`, inline: true },
            { name: 'Ticket', value: `#${ticket.ticketNumber} | ${ticket.category}`, inline: true }
          );

        const adminButtons = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`admin_ban_${targetId}`).setLabel('Zbanuj użytkownika').setStyle(ButtonStyle.Danger),
          new ButtonBuilder().setCustomId(`admin_kick_${targetId}`).setLabel('Wyrzuć użytkownika').setStyle(ButtonStyle.Danger),
          new ButtonBuilder().setCustomId(`admin_warn_${targetId}`).setLabel('Ostrzeż użytkownika').setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId(`admin_giverole_${targetId}`).setLabel('Dodaj rolę użytkownikowi').setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId(`admin_force_close_${targetId}`).setLabel('Usuń ticket (siłowo)').setStyle(ButtonStyle.Secondary)
        );

        await interaction.reply({ embeds: [adminEmbed], components: [adminButtons], ephemeral: true });
        return;
      }

      case 'admin_ban': {
        if (!canUseAdminButtons) {
          await interaction.reply({ content: '❌ Nie masz uprawnień.', ephemeral: true });
          return;
        }
        // Potwierdzenie (tak/nie)
        const confirmRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`confirm_ban_yes_${targetId}`).setLabel('Tak — Zbanuj').setStyle(ButtonStyle.Danger),
          new ButtonBuilder().setCustomId(`confirm_no_${targetId}`).setLabel('Anuluj').setStyle(ButtonStyle.Secondary)
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
          await sendLog(client, `Zbanowano użytkownika z ticketu #${ticket.ticketNumber}`, `Użytkownik <@${ownerId}> został zbanowany przez <@${interaction.user.id}>.`, [
            { name: 'Ticket', value: `#${ticket.ticketNumber}` },
            { name: 'Kanał', value: `<#${targetId}>` }
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
          new ButtonBuilder().setCustomId(`confirm_kick_yes_${targetId}`).setLabel('Tak — Wyrzuć').setStyle(ButtonStyle.Danger),
          new ButtonBuilder().setCustomId(`confirm_no_${targetId}`).setLabel('Anuluj').setStyle(ButtonStyle.Secondary)
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
          await sendLog(client, `Wyrzucono użytkownika z ticketu #${ticket.ticketNumber}`, `Użytkownik <@${ownerId}> został wyrzucony przez <@${interaction.user.id}>.`, [
            { name: 'Ticket', value: `#${ticket.ticketNumber}` },
            { name: 'Kanał', value: `<#${targetId}>` }
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
        // otwórz modal do podania powodu ostrzeżenia (customId zawiera channelId)
        const modal = new ModalBuilder()
          .setCustomId(`modal_warn_${targetId}`)
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
          .setCustomId(`modal_giverole_${targetId}`)
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
        // natychmiastowe usuwanie kanału i log
        try {
          const ch = await guild.channels.fetch(targetId).catch(() => null);
          if (ch) {
            await ch.delete().catch(() => {});
          }
          // jeżeli był timeout scheduled — clear it
          const stored = ticketData.get(targetId);
          if (stored?.closeTimeoutId) clearTimeout(stored.closeTimeoutId);
          ticketData.delete(targetId);
          await sendLog(client, `Usunięto ticket #${ticket.ticketNumber}`, `Ticket usunięty siłowo przez <@${interaction.user.id}>.`, [
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

  // Obsługa modali z panelu admin (warn i giverole)
  client.on(Events.InteractionCreate, async interaction => {
    if (!interaction.isModalSubmit()) return;

    // WARN modal: customId = modal_warn_<channelId>
    if (interaction.customId.startsWith('modal_warn_')) {
      const channelId = interaction.customId.replace('modal_warn_', '');
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
        await sendLog(client, `Ostrzeżono użytkownika z ticketu #${data.ticketNumber}`, `Ostrzeżenie wysłane przez <@${interaction.user.id}>.`, [
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

    // GIVERODE modal: customId = modal_giverole_<channelId>
    if (interaction.customId.startsWith('modal_giverole_')) {
      const channelId = interaction.customId.replace('modal_giverole_', '');
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
        await sendLog(client, `Dodano rolę użytkownikowi z ticketu #${data.ticketNumber}`, `Rola ${role.name} została dodana do <@${ownerId}> przez <@${interaction.user.id}>.`, [
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

  // Bezpieczne czyszczenie timoutów przy zamykaniu bota (opcjonalne)
  process.on('exit', () => {
    for (const [, data] of ticketData) {
      if (data?.closeTimeoutId) clearTimeout(data.closeTimeoutId);
    }
  });
};