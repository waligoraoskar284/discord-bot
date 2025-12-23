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
  PermissionsBitField
} = require('discord.js');

let ticketNumberCounter = 0;      // numer ticketa wyświetlany w tytule (Ticket #N)
let transactionCounter = 0;       // osobny licznik dla Transaction ID (używany tylko w ZAKUPY)
const ticketData = new Map();     // mapuje channelId -> { ownerId, transactionId, ticketNumber }

module.exports = (client) => {
  const TICKET_CHANNEL_ID = '1312759128627871816';
  const ADMIN_ROLE_ID = '1436376487157694586';
  const MOD_BUTTONS_ROLE_ID = '1321051189848047636'; // rola, która może używać przycisków admina w ticketach
  const TICKETS_CATEGORY_ID = '1313052528761503795'; // kategoria, pod którą tworzą się tickety

  const getEmoji = (id) => client.emojis.cache.get(id)?.toString() || '';

  // usuwa stare wiadomości wysłane przez bota z menu ticketowym (żeby uniknąć wartości ephemeral/locked)
  const deleteOldSetupMessages = async (channel) => {
    try {
      const messages = await channel.messages.fetch({ limit: 200 });
      const botMessages = messages.filter(m =>
        m.author?.id === client.user.id &&
        (m.components?.some(row => row.components?.some(c => c.customId === 'ticket_category')) ||
          m.embeds?.some(e => e.title && e.title.includes('Wybierz kategorię')))
      );
      for (const [, msg] of botMessages) {
        await msg.delete().catch(() => { /* ignore */ });
      }
    } catch (err) {
      console.error('Błąd przy usuwaniu starych wiadomości setup:', err);
    }
  };

  // wysyła publiczną wiadomość z wyborem kategorii
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

  // opcjonalna komenda /setup — wysyła publicznie wiadomość (tylko dla adminów)
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

  // obsługa wyboru kategorii -> pokazanie modala (KAŻDY może otworzyć ticketa)
  client.on(Events.InteractionCreate, async interaction => {
    if (!interaction.isStringSelectMenu()) return;
    if (interaction.customId !== 'ticket_category') return;

    // WAŻNE: menu musi być wysłane publicznie (channel.send), wtedy każdy może z niego korzystać.
    // Tutaj nie blokujemy po rolach: każdy na serwerze może otworzyć ticket.
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

  // obsługa modal submit -> tworzenie ticketa
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

    // Używamy ticketNumberCounter (zwiększanego wcześniej przy otwieraniu modala) do tytułu
    // Transaction ID jest oddzielnym licznikiem i zwiększamy go tylko dla ZAKUPY
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

      // zwiększamy oddzielny transactionCounter i zapisujemy transactionId
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

    // Tworzymy kanał w wyznaczonej kategorii
    let ticketChannel;
    try {
      ticketChannel = await guild.channels.create({
        name: channelName,
        type: 0, // text
        parent: TICKETS_CATEGORY_ID,
        permissionOverwrites: [
          { id: guild.roles.everyone, deny: [PermissionsBitField.Flags.ViewChannel] },
          { id: user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] },
          { id: ADMIN_ROLE_ID, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ManageChannels, PermissionsBitField.Flags.ReadMessageHistory] },
          // pozostawiamy rolę MOD_BUTTONS_ROLE_ID bez domyślnych przywilejów kanału — role mają specjalne uprawnienia do używania przycisków
        ]
      });
    } catch (err) {
      console.error('Błąd przy tworzeniu kanału ticketowego:', err);
      await interaction.reply({ content: '❌ Wystąpił błąd podczas tworzenia kanału ticketowego.', ephemeral: true });
      return;
    }

    // Zapisujemy dane ticketa do pamięci (można później przenieść do DB jeśli potrzeba)
    ticketData.set(ticketChannel.id, {
      ownerId: user.id,
      transactionId: transactionId, // null jeśli INNE
      ticketNumber: ticketNumber,
      category
    });

    // Embed z informacjami wewnątrz kanału ticketowego
    const ticketEmbed = new EmbedBuilder()
      .setTitle(`Ticket #${ticketNumber} | ${category}`)
      .setColor(category === 'ZAKUPY' ? 'Red' : 'Orange')
      .setFields(embedFields)
      .setThumbnail(user.displayAvatarURL({ dynamic: true, size: 1024 }))
      .setFooter({ text: `Utworzony przez: ${user.tag}` });

    const buttons = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('close_ticket')
        .setLabel('Zamknij ticket')
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId('admin_panel')
        .setLabel('Panel administracyjny')
        .setStyle(ButtonStyle.Primary)
    );

    // Wyślij embed do kanału ticketowego z przyciskami
    await ticketChannel.send({ content: `<@${user.id}> — witaj w Twoim tickecie`, embeds: [ticketEmbed], components: [buttons] });

    // Odpowiedz użytkownikowi, wskaż kanał ticketa (polski komunikat)
    await interaction.reply({ content: `✅ Twój ticket został otworzony: <#${ticketChannel.id}>`, ephemeral: true });
  });

  // Obsługa kliknięć przycisków (close_ticket, admin_panel, oraz późniejsze admin action buttons)
  client.on(Events.InteractionCreate, async interaction => {
    if (!interaction.isButton()) return;

    const guild = interaction.guild;
    const member = interaction.member;
    const channel = interaction.channel;

    // Przyciski na wiadomości w kanałach ticketowych
    if (!channel || !ticketData.has(channel.id)) {
      // Nie jesteśmy w kanale ticketowym (albo brak danych) — ignorujemy
      await interaction.reply({ content: '❌ To nie jest kanał ticketowy lub brak danych.', ephemeral: true }).catch(() => {});
      return;
    }

    const ticket = ticketData.get(channel.id);
    const ownerId = ticket.ownerId;

    // Sprawdzenie uprawnień do używania przycisków administracyjnych:
    const canUseAdminButtons = member.roles.cache.has(ADMIN_ROLE_ID) ||
      member.roles.cache.has(MOD_BUTTONS_ROLE_ID) ||
      member.permissions.has(PermissionsBitField.Flags.ManageChannels);

    // Zamknięcie ticketu (przycisk 'Zamknij ticket') - dostępy: owner OR osoby z uprawnieniami admin/mod
    if (interaction.customId === 'close_ticket') {
      if (member.id !== ownerId && !canUseAdminButtons) {
        await interaction.reply({ content: '❌ Nie masz uprawnień do zamknięcia tego ticketa.', ephemeral: true });
        return;
      }
      try {
        await channel.delete().catch(() => { /* ignore */ });
        ticketData.delete(channel.id);
        // jeśli usuwamy kanał, nie możemy wysłać kolejnej odpowiedzi w tym kanale
        await interaction.reply({ content: '✅ Ticket został zamknięty i kanał usunięty.', ephemeral: true }).catch(() => {});
      } catch (err) {
        console.error('Błąd przy usuwaniu kanału:', err);
        await interaction.reply({ content: '❌ Nie udało się zamknąć ticketa.', ephemeral: true });
      }
      return;
    }

    // Panel administracyjny - tylko dla uprawnionych ról
    if (interaction.customId === 'admin_panel') {
      if (!canUseAdminButtons) {
        await interaction.reply({ content: '❌ Nie masz uprawnień do otwarcia panelu administracyjnego.', ephemeral: true });
        return;
      }

      // pokażemy adminowi zestaw przycisków z 5 funkcjami
      const adminEmbed = new EmbedBuilder()
        .setTitle('Panel administracyjny — funkcje')
        .setDescription('Wybierz jedną z poniższych operacji dotyczących użytkownika, który otworzył ticket.')
        .setColor('Purple')
        .addFields(
          { name: 'Użytkownik ticketa', value: `<@${ownerId}>`, inline: true },
          { name: 'Ticket', value: `#${ticket.ticketNumber} | ${ticket.category}`, inline: true }
        );

      const adminButtons = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('admin_ban').setLabel('Zbanuj użytkownika').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('admin_kick').setLabel('Wyrzuć użytkownika').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('admin_warn').setLabel('Ostrzeż użytkownika').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('admin_giverole').setLabel('Dodaj rolę użytkownikowi').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('admin_force_close').setLabel('Usuń ticket (siłowo)').setStyle(ButtonStyle.Secondary)
      );

      await interaction.reply({ embeds: [adminEmbed], components: [adminButtons], ephemeral: true });
      return;
    }

    // Poniżej obsługa akcji z panelu admina:
    // Dla prostoty: wszystkie akcje wykorzystują channel.id aby znaleźć ownera przez ticketData

    // BAN - pokazujemy potwierdzenie (tak/nie)
    if (interaction.customId === 'admin_ban') {
      if (!canUseAdminButtons) {
        await interaction.reply({ content: '❌ Nie masz uprawnień.', ephemeral: true });
        return;
      }
      const confirmRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('confirm_ban_yes').setLabel('Tak — Zbanuj').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('confirm_no').setLabel('Anuluj').setStyle(ButtonStyle.Secondary)
      );
      await interaction.reply({ content: `Potwierdź zbanowanie użytkownika <@${ownerId}>.`, components: [confirmRow], ephemeral: true });
      return;
    }

    if (interaction.customId === 'confirm_ban_yes') {
      if (!canUseAdminButtons) {
        await interaction.reply({ content: '❌ Nie masz uprawnień.', ephemeral: true });
        return;
      }
      try {
        await guild.members.ban(ownerId, { reason: `Zbanowany z poziomu panelu admina — ticket ${channel.id}` });
        await interaction.reply({ content: `✅ Użytkownik <@${ownerId}> został zbanowany.`, ephemeral: true });
      } catch (err) {
        console.error('Błąd przy banowaniu:', err);
        await interaction.reply({ content: '❌ Nie udało się zbanować użytkownika. Sprawdź uprawnienia bota.', ephemeral: true });
      }
      return;
    }

    // KICK - potwierdzenie
    if (interaction.customId === 'admin_kick') {
      if (!canUseAdminButtons) {
        await interaction.reply({ content: '❌ Nie masz uprawnień.', ephemeral: true });
        return;
      }
      const confirmRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('confirm_kick_yes').setLabel('Tak — Wyrzuć').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('confirm_no').setLabel('Anuluj').setStyle(ButtonStyle.Secondary)
      );
      await interaction.reply({ content: `Potwierdź wyrzucenie użytkownika <@${ownerId}>.`, components: [confirmRow], ephemeral: true });
      return;
    }

    if (interaction.customId === 'confirm_kick_yes') {
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
        await memberToKick.kick(`Wyrzucony z poziomu panelu admina — ticket ${channel.id}`);
        await interaction.reply({ content: `✅ Użytkownik <@${ownerId}> został wyrzucony.`, ephemeral: true });
      } catch (err) {
        console.error('Błąd przy kick:', err);
        await interaction.reply({ content: '❌ Nie udało się wyrzucić użytkownika. Sprawdź uprawnienia bota.', ephemeral: true });
      }
      return;
    }

    // ANULUJ potwierdzenia
    if (interaction.customId === 'confirm_no') {
      await interaction.reply({ content: '❌ Anulowano operację.', ephemeral: true });
      return;
    }

    // OSTRZEŻ - otwórz modal z powodem ostrzeżenia
    if (interaction.customId === 'admin_warn') {
      if (!canUseAdminButtons) {
        await interaction.reply({ content: '❌ Nie masz uprawnień.', ephemeral: true });
        return;
      }
      const modal = new ModalBuilder()
        .setCustomId(`modal_warn_${channel.id}`)
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

    // DODAJ ROLĘ - modal: podaj ID roli
    if (interaction.customId === 'admin_giverole') {
      if (!canUseAdminButtons) {
        await interaction.reply({ content: '❌ Nie masz uprawnień.', ephemeral: true });
        return;
      }
      const modal = new ModalBuilder()
        .setCustomId(`modal_giverole_${channel.id}`)
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
      await interaction.showModal(modal);
      return;
    }

    // USUNIĘCIE TICKETA (siłowe) - tylko dla uprawnionych
    if (interaction.customId === 'admin_force_close') {
      if (!canUseAdminButtons) {
        await interaction.reply({ content: '❌ Nie masz uprawnień.', ephemeral: true });
        return;
      }
      try {
        await channel.delete().catch(() => { /* ignore */ });
        ticketData.delete(channel.id);
        await interaction.reply({ content: '✅ Ticket został usunięty siłowo.', ephemeral: true });
      } catch (err) {
        console.error('Błąd przy usuwaniu kanału:', err);
        await interaction.reply({ content: '❌ Nie udało się usunąć kanału.', ephemeral: true });
      }
      return;
    }
  });

  // Obsługa modali wysyłanych z panelu admina (ostrzeżenie, dodanie roli)
  client.on(Events.InteractionCreate, async interaction => {
    if (!interaction.isModalSubmit()) return;

    // warn modal
    if (interaction.customId.startsWith('modal_warn_')) {
      const channelId = interaction.customId.replace('modal_warn_', '');
      const data = ticketData.get(channelId);
      if (!data) {
        await interaction.reply({ content: '❌ Nie znaleziono danych ticketa.', ephemeral: true });
        return;
      }
      const reason = interaction.fields.getTextInputValue('warn_reason');
      const guild = interaction.guild;
      const ownerId = data.ownerId;

      // wysyłamy DM do użytkownika i wiadomość w kanale ticketowym (jeśli istnieje)
      try {
        const memberToWarn = await guild.members.fetch(ownerId).catch(() => null);
        if (memberToWarn) {
          await memberToWarn.send(`Otrzymałeś ostrzeżenie na serwerze ${guild.name}.\nPowód: ${reason}`).catch(() => {});
        }
        // jeśli kanał istnieje, wyślij tam info
        const ticketChannel = await guild.channels.fetch(channelId).catch(() => null);
        if (ticketChannel) {
          await ticketChannel.send({ content: `⚠️ Użytkownik <@${ownerId}> został ostrzeżony.\nPowód: ${reason}` }).catch(() => {});
        }

        await interaction.reply({ content: `✅ Ostrzeżenie wysłane do <@${ownerId}>.`, ephemeral: true });
      } catch (err) {
        console.error('Błąd przy ostrzeżeniu:', err);
        await interaction.reply({ content: '❌ Wystąpił błąd podczas wysyłania ostrzeżenia.', ephemeral: true });
      }
      return;
    }

    // giverole modal
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
        // powiadomienia
        const ticketChannel = await guild.channels.fetch(channelId).catch(() => null);
        if (ticketChannel) {
          await ticketChannel.send({ content: `✅ Dodano rolę ${role} użytkownikowi <@${ownerId}>.` }).catch(() => {});
        }
        await interaction.reply({ content: `✅ Rola została dodana użytkownikowi <@${ownerId}>.`, ephemeral: true });
      } catch (err) {
        console.error('Błąd przy dodawaniu roli:', err);
        await interaction.reply({ content: '❌ Nie udało się dodać roli. Sprawdź uprawnienia bota.', ephemeral: true });
      }
      return;
    }
  });

  // Jeśli bot restartuje się i ktoś kliknie stare komponenty — przypomnienie w języku polskim:
  client.on(Events.InteractionCreate, async interaction => {
    // jeśli ktoś klika select menu, ale nie mamy go w kodzie — ignorujemy, ale wysyłamy pomocniczy komunikat
    if (interaction.isStringSelectMenu() && interaction.customId === 'ticket_category') {
      // nic tu nie robimy, bo obsługa już wcześniej
      return;
    }
  });

};