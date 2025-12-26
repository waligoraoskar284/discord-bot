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
  // kanał, gdzie wysyłamy stałe menu (zmienione zgodnie z życzeniem)
  const TICKET_CHANNEL_ID = '1454069542283120642';
  const MOD_BUTTONS_ROLE_ID = '1321051189848047636';
  const TICKETS_CATEGORY_ID = '1313052528761503795';
  const CLOSED_CATEGORY_ID = '1453095347940491464'; // zamknięte tickety -> ta kategoria
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
      // logowanie ograniczone żeby nie spamować konsoli
      console.error('[ticket] Błąd przy wysyłaniu loga:', err?.message || err);
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

  // używane tylko przy starcie
  const parseTokenFromMessage = (msg) => {
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
      console.error('[ticket] cleanSetupMessages error:', err?.message || err);
    }
  };

  const sendSetupMessage = async (channel) => {
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
      // UWAGA: NIE USUWAMY istniejących wiadomości setup. Po restarcie bot wysyła nową wiadomość i pozostawia stare nietknięte.
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
      console.error('[ticket] rebuildTicketDataFromChannel error:', err?.message || err);
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
        console.error('[ticket] Błąd przy edycji nadpisań uprawnień:', errPerm?.message || errPerm);
      }

      await ch.setParent(CLOSED_CATEGORY_ID).catch(() => {});

      const timeoutId = setTimeout(async () => {
        try {
          const toDel = await client.channels.fetch(channelId).catch(() => null);
          if (toDel) await toDel.delete().catch(() => {});
        } catch (err) {
          console.error('[ticket] Błąd przy automatycznym usuwaniu kanału:', err?.message || err);
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
      console.error('[ticket] performClose error:', err?.message || err);
    }
  };

  // READY: wysyłamy JEDNĄ wiadomość - NIE usuwamy istniejących
  client.once(Events.ClientReady, async () => {
    try {
      const ch = await client.channels.fetch(TICKET_CHANNEL_ID).catch(() => null);
      if (!ch) return console.log('[ticket] Nie znaleziono kanału ticketowego (setup).');

      // Nie usuwamy istniejących wiadomości setup - po restarcie bot po prostu wysyła nową wiadomość
      const newMsg = await sendSetupMessage(ch);
      if (newMsg) lastSetup = { messageId: newMsg.id };

      console.log('[ticket] Menu ticketowe wysłane (raz) po starcie. Nie usuwano istniejących wiadomości.');
    } catch (err) {
      console.error('[ticket] Ready error:', err?.message || err);
    }
  });

  // Jeden handler dla wszystkich interakcji -> mniejsze ryzyko konfliktów / nieobsłużonych przypadków
  client.on(Events.InteractionCreate, async (interaction) => {
    try {
      // 1) Select menu (otwieranie modala)
      if (interaction.isStringSelectMenu()) {
        if (interaction.customId !== 'TICKET_MENU::ticket_category') return;
        // ochrona: tylko menu wysłane przez naszego bota
        if (!interaction.message?.author || interaction.message.author.id !== client.user?.id) {
          try {
            await interaction.reply({ content: '❗ Ten przycisk nie pochodzi z aktualnego menu. Skontaktuj się z administracją.', flags: 64 });
          } catch { /* ignore */ }
          return;
        }

        const user = interaction.user;
        const selected = interaction.values[0]; // 'inne' lub 'zakupy'

        // sprawdź czy użytkownik nie ma już otwartego ticketu w tej kategorii
        const wantedCategory = selected === 'zakupy' ? 'ZAKUPY' : 'INNE';
        const existingCh = userHasOpenTicketInCategory(interaction.guild, user.id, wantedCategory);
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

        // showModal - może zwrócić Unknown interaction gdy interakcja przeterminowana -> ignorujemy taki błąd
        try {
          await interaction.showModal(modal);
        } catch (err) {
          // DiscordAPIError 10062 = Unknown interaction -> użytkownik klika za długo po wygaśnięciu interakcji
          if (err?.rawError?.code === 10062 || err?.code === 10062) {
            // ciche zignorowanie bez spamowania konsoli
            return;
          }
          console.error('[ticket] showModal error:', err?.message || err);
          try { await interaction.reply({ content: '❌ Nie udało się otworzyć formularza. Spróbuj ponownie.', flags: 64 }); } catch {}
        }
        return;
      }

      // 2) Modal submit (tworzenie ticketa)
      if (interaction.isModalSubmit()) {
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

        // jeszcze raz zabezpieczamy przed wielokrotnym ticketem w tej samej kategorii
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
            // moderatorom dajemy widok bez prawa wysyłania (możesz zmienić)
            permOverwrites.push({ id: MOD_BUTTONS_ROLE_ID, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.ReadMessageHistory] });
          }

          ticketChannel = await interaction.guild.channels.create({
            name: channelName,
            type: ChannelType.GuildText,
            parent: TICKETS_CATEGORY_ID,
            permissionOverwrites: permOverwrites
          });
        } catch (err) {
          console.error('[ticket] Błąd przy tworzeniu kanału:', err?.message || err);
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

        // odpowiedź sukcesu - używamy flags (64) zamiast deprecated ephemeral
        try {
          const successEmbed = new EmbedBuilder()
            .setTitle('POMYŚLNIE UTWORZONO TICKET')
            .setDescription(`Sukces! Twój ticket sklepu został utworzony — znajdziesz go na wskazanym kanale: <#${ticketChannel.id}>`)
            .setColor('Blue')
            .setTimestamp();
          await interaction.reply({ embeds: [successEmbed], flags: 64 });
        } catch (e) {
          // możliwe, że interaction przeterminowany -> ciche zignorowanie
        }

        await sendLog('Utworzono ticket', `Utworzono ticket (${category})`, [
          { name: 'Kanał', value: `<#${ticketChannel.id}>` },
          { name: 'Użytkownik', value: `<@${user.id}> (${user.tag})` },
          { name: 'Transaction ID', value: transactionId ? String(transactionId) : 'brak' },
          { name: 'Data utworzenia', value: createdDateStr }
        ], 'Green');

        return;
      }

      // 3) Buttony (zamknięcie / admin / reopen z loga)
      if (interaction.isButton()) {
        const id = interaction.customId;
        if (!id) return;

        // Zamknij ticket
        if (id.startsWith('close_ticket::')) {
          const [, channelId] = id.split('::');
          // tylko użytkownicy mający dostęp do kanału (lub moderatorzy) mogą zamykać - minimalna ochrona:
          try {
            // wykonaj zamknięcie i odpowiedz
            await performClose(channelId, interaction.user.id);
            try { await interaction.reply({ content: '✅ Ticket został zamknięty i przeniesiony do archiwum.', flags: 64 }); } catch {}
          } catch (err) {
            console.error('[ticket] close_ticket handler error:', err?.message || err);
            try { await interaction.reply({ content: '❌ Wystąpił błąd podczas zamykania ticketu.', flags: 64 }); } catch {}
          }
          return;
        }

        // Panel admina (prosty)
        if (id.startsWith('admin_panel::')) {
          const [, channelId] = id.split('::');
          try {
            // uprawnienia: właściciel kanału, moderator, admin
            const tdata = ticketData.get(channelId) || await getTicketData(channelId, interaction.guild);
            const isOwner = tdata?.ownerId === interaction.user.id;
            const member = interaction.member;
            const isMod = member?.roles?.cache?.has(MOD_BUTTONS_ROLE_ID);
            const isAdmin = ADMIN_ROLE_ID ? member?.roles?.cache?.has(ADMIN_ROLE_ID) : false;
            if (!isOwner && !isMod && !isAdmin) {
              try { await interaction.reply({ content: '❌ Nie masz uprawnień do panelu administracyjnego tego ticketu.', flags: 64 }); } catch {}
              return;
            }

            const adminEmbed = new EmbedBuilder()
              .setTitle('Panel administracyjny')
              .setDescription('Wybierz akcję dla ticketu')
              .setColor('DarkBlue')
              .setTimestamp();

            const adminButtons = new ActionRowBuilder().addComponents(
              new ButtonBuilder().setCustomId(`close_ticket::${channelId}`).setLabel('Zamknij ticket').setStyle(ButtonStyle.Danger),
              new ButtonBuilder().setCustomId(`force_delete::${channelId}`).setLabel('Usuń kanał').setStyle(ButtonStyle.Secondary)
            );

            try { await interaction.reply({ embeds: [adminEmbed], components: [adminButtons], flags: 64 }); } catch {}
          } catch (err) {
            console.error('[ticket] admin_panel handler error:', err?.message || err);
            try { await interaction.reply({ content: '❌ Błąd w panelu administracyjnym.', flags: 64 }); } catch {}
          }
          return;
        }

        // Otwórz ponownie ticket (z logów)
        if (id.startsWith('log_reopen::')) {
          const [, channelId] = id.split('::');
          try {
            const ch = await client.channels.fetch(channelId).catch(() => null);
            if (!ch) {
              try { await interaction.reply({ content: '❌ Nie znaleziono kanału.', flags: 64 }); } catch {}
              return;
            }

            const stored = ticketData.get(channelId);
            // przywróć właścicielowi dostęp jeśli go znamy
            if (stored?.ownerId) {
              try {
                await ch.permissionOverwrites.edit(stored.ownerId, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true }).catch(() => {});
              } catch (e) { /* ignore */ }
            }

            await ch.setParent(TICKETS_CATEGORY_ID).catch(() => {});
            // wyczyść planowane usunięcie
            if (stored?.closeTimeoutId) {
              try { clearTimeout(stored.closeTimeoutId); } catch (e) { }
              stored.closeTimeoutId = null;
              ticketData.set(channelId, stored);
            }

            await sendLog('Otworzono ponownie ticket', `Ticket przywrócony z archiwum: <#${channelId}>`, [
              { name: 'Przywrócone przez', value: `<@${interaction.user.id}>` }
            ], 'Green');

            try { await interaction.reply({ content: `✅ Ticket został otworzony ponownie: <#${channelId}>`, flags: 64 }); } catch {}
          } catch (err) {
            console.error('[ticket] log_reopen handler error:', err?.message || err);
            try { await interaction.reply({ content: '❌ Błąd przy otwieraniu ticketu.', flags: 64 }); } catch {}
          }
          return;
        }

        // Force delete (admin panel) - ostrożnie
        if (id.startsWith('force_delete::')) {
          const [, channelId] = id.split('::');
          try {
            // uprawnienia sprawdzamy tylko minimalnie - tylko rola admin/mod może użyć (sprawdzane wcześniej w panelu)
            const ch = await client.channels.fetch(channelId).catch(() => null);
            if (!ch) {
              try { await interaction.reply({ content: '❌ Kanał nie istnieje.', flags: 64 }); } catch {}
              return;
            }
            await ch.delete().catch(() => {});
            ticketData.delete(channelId);
            await sendLog('Usunięto ticket (force)', `Kanał usunięty ręcznie przez ${interaction.user.tag}`, [
              { name: 'Kanał', value: `#${ch.name}` },
              { name: 'Użytkownik', value: `<@${interaction.user.id}>` }
            ], 'Grey');
            try { await interaction.reply({ content: '✅ Kanał został usunięty.', flags: 64 }); } catch {}
          } catch (err) {
            console.error('[ticket] force_delete handler error:', err?.message || err);
            try { await interaction.reply({ content: '❌ Nie udało się usunąć kanału.', flags: 64 }); } catch {}
          }
          return;
        }
      }

    } catch (err) {
      // globalny catch dla handlera interakcji - logujemy tylko wiadomość żeby nie spamować
      console.error('[ticket] interaction handler uncaught error:', err?.message || err);
      try { if (!interaction.replied && !interaction.deferred) await interaction.reply({ content: '❌ Wystąpił błąd. Skontaktuj się z administracją.', flags: 64 }); } catch {}
    }
  });

  // cleanup przy zamknięciu procesu
  process.on('exit', () => {
    for (const [, data] of ticketData) {
      if (data?.closeTimeoutId) clearTimeout(data.closeTimeoutId);
      if (data?.closeConfirmTimeoutId) clearTimeout(data.closeConfirmTimeoutId);
    }
  });
};