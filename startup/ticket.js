/**
 * tickets.js
 * Przykładowy moduł ticketów dla discord.js v14
 *
 * Ustaw stałe konfiguracyjne poniżej:
 * - TICKET_CHANNEL_ID: kanał gdzie bot wysyła menu wyboru kategorii
 * - TICKETS_CATEGORY_ID: kategoria, do której trafiają nowe tickety
 * - CLOSED_CATEGORY_ID: kategoria, do której przenosimy zamknięte tickety
 * - LOG_CHANNEL_ID: kanał logów
 * - MOD_BUTTONS_ROLE_ID: rola moderatorów (opcjonalnie)
 * - ADMIN_ROLE_ID: rola adminów (opcjonalnie)
 *
 * Wymaga discord.js v14.
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
  ChannelType
} = require('discord.js');

let ticketNumberCounter = 0;
let transactionCounter = 0;
const ticketData = new Map();
let lastSetup = { messageId: null };

// --- KONFIG ---
const TICKET_CHANNEL_ID = '1454069542283120642';
const MOD_BUTTONS_ROLE_ID = '1321051189848047636';
const TICKETS_CATEGORY_ID = '1313052528761503795';
const CLOSED_CATEGORY_ID = '1453095347940491464';
const LOG_CHANNEL_ID = '1452581189415338135';
const AUTO_DELETE_AFTER_MS = 10 * 60 * 60 * 1000; // 10h
const ADMIN_ROLE_ID = null; // wstaw id jeśli chcesz
// --------------

module.exports = (client) => {
  const getEmoji = (id) => client.emojis.cache.get(id)?.toString() || '';

  const nextTransactionId = () => ++transactionCounter;

  const sendLog = async (title, description = '', fields = [], color = 'Blue', components = []) => {
    try {
      const ch = await client.channels.fetch(LOG_CHANNEL_ID).catch(() => null);
      if (!ch) return;
      const embed = new EmbedBuilder()
        .setTitle(title)
        .setDescription(description || '')
        .setColor(color)
        .setTimestamp()
        .setFooter({ text: 'System ticketów' })
        .setAuthor({ name: client.user?.username || 'Bot', iconURL: client.user?.displayAvatarURL?.() });
      if (fields.length) embed.addFields(fields);
      await ch.send({ embeds: [embed], components }).catch(() => {});
    } catch (err) {
      console.error('[ticket] sendLog error:', err?.message || err);
    }
  };

  // Sprawdza, czy wiadomość to wysłane przez nas menu setup
  const isSetupMessage = (m) => {
    try {
      if (!m || !m.author || m.author.id !== client.user?.id) return false;
      const hasSelect = m.components?.some(row =>
        row.components?.some(c => c?.customId === 'TICKET_MENU::ticket_category')
      );
      const hasEmbed = m.embeds?.some(e => typeof e.title === 'string' && e.title.includes('Wybierz kategorię'));
      return Boolean(hasSelect || hasEmbed);
    } catch {
      return false;
    }
  };

  // Wysyła menu setup do kanału (raz po starcie)
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

    const select = new StringSelectMenuBuilder()
      .setCustomId('TICKET_MENU::ticket_category')
      .setPlaceholder('💡 Wybierz kategorię ticketa...')
      .addOptions([
        { label: 'INNE', description: 'Problemy niezwiązane z zakupem', value: 'inne', emoji: { id: '1452715580456042647' } },
        { label: 'ZAKUPY', description: 'Zakup sprawdzianu/kartkówki', value: 'zakupy', emoji: { id: '1453054774172975124' } }
      ])
      .setMinValues(1)
      .setMaxValues(1);

    const row = new ActionRowBuilder().addComponents(select);
    const sent = await channel.send({ embeds: [embed], components: [row] }).catch(() => null);
    if (sent) lastSetup = { messageId: sent.id };
    return sent;
  };

  // Odtwarza ticketData z istniejącego kanału (używane np. jeśli bot restartował się i kanał już istnieje)
  const rebuildTicketDataFromChannel = async (channel) => {
    try {
      const overwrites = channel.permissionOverwrites.cache;
      // szukamy nadpisania dla użytkownika (z uprawnieniem SendMessages)
      const memberOw = overwrites.find(ow => {
        const numeric = !isNaN(Number(ow.id));
        if (!numeric) return false;
        return ow.allow?.has?.(PermissionsBitField.Flags.SendMessages);
      });
      if (memberOw) {
        const ownerId = memberOw.id;
        const category = channel.name.startsWith('🛒') ? 'ZAKUPY' : channel.name.startsWith('❓') ? 'INNE' : 'INNE';
        const createdAt = channel.createdAt?.toISOString() || new Date().toISOString();
        const data = { ownerId, transactionId: null, ticketNumber: null, category, createdAt, closeTimeoutId: null, closeConfirmTimeoutId: null };
        ticketData.set(channel.id, data);
        return data;
      }
    } catch (err) {
      console.error('[ticket] rebuildTicketDataFromChannel error:', err?.message || err);
    }
    return null;
  };

  // Pobiera ticketData, odtwarzając z kanału jeżeli trzeba
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

  // Sprawdza czy użytkownik ma już otwarty ticket w danej kategorii
  const userHasOpenTicketInCategory = (guild, userId, wantedCategory) => {
    try {
      const channels = guild.channels.cache.filter(ch => ch.type === ChannelType.GuildText && ch.parentId === TICKETS_CATEGORY_ID);
      for (const ch of channels.values()) {
        const ow = ch.permissionOverwrites.cache.get(userId);
        if (!ow) continue;
        if (ow.allow?.has?.(PermissionsBitField.Flags.SendMessages)) {
          const cat = ch.name.startsWith('🛒') ? 'ZAKUPY' : ch.name.startsWith('❓') ? 'INNE' : null;
          if (cat === wantedCategory) return ch;
        }
      }
    } catch (e) {
      // ignore
    }
    return null;
  };

  // Zamyka ticket: odbiera dostęp użytkownikowi, przenosi do kategorii CLOSED_CATEGORY_ID i ustawia auto-usuwanie
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

      // odebranie dostępu właścicielowi
      try {
        if (ownerId) await ch.permissionOverwrites.edit(ownerId, { ViewChannel: false, SendMessages: false, ReadMessageHistory: true }).catch(() => {});
        if (ADMIN_ROLE_ID) await ch.permissionOverwrites.edit(ADMIN_ROLE_ID, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true }).catch(() => {});
        if (MOD_BUTTONS_ROLE_ID) await ch.permissionOverwrites.edit(MOD_BUTTONS_ROLE_ID, { ViewChannel: true, SendMessages: false, ReadMessageHistory: true }).catch(() => {});
      } catch (errPerm) {
        console.error('[ticket] permission edit error:', errPerm?.message || errPerm);
      }

      await ch.setParent(CLOSED_CATEGORY_ID).catch(() => {});

      const timeoutId = setTimeout(async () => {
        try {
          const toDel = await client.channels.fetch(channelId).catch(() => null);
          if (toDel) await toDel.delete().catch(() => {});
        } catch (err) {
          console.error('[ticket] auto-delete error:', err?.message || err);
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

      if (!stored) {
        ticketData.set(channelId, { ownerId, transactionId: null, ticketNumber: null, category: null, createdAt: new Date().toISOString(), closeTimeoutId: timeoutId, closeConfirmTimeoutId: null });
      } else {
        if (stored.closeConfirmTimeoutId) {
          try { clearTimeout(stored.closeConfirmTimeoutId); } catch {}
          stored.closeConfirmTimeoutId = null;
        }
        stored.closeTimeoutId = timeoutId;
        ticketData.set(channelId, stored);
      }

      // log zamknięcia
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

  // READY -> wyślij menu do kanału setup
  client.once(Events.ClientReady, async () => {
    try {
      const ch = await client.channels.fetch(TICKET_CHANNEL_ID).catch(() => null);
      if (!ch) return console.log('[ticket] Nie znaleziono kanału ticketowego (setup).');
      const newMsg = await sendSetupMessage(ch);
      if (newMsg) lastSetup = { messageId: newMsg.id };
      console.log('[ticket] Menu ticketowe wysłane po starcie.');
    } catch (err) {
      console.error('[ticket] Ready error:', err?.message || err);
    }
  });

  // Globalny handler interakcji
  client.on(Events.InteractionCreate, async (interaction) => {
    try {
      // 1) Select menu -> pokaz modal
      if (interaction.isStringSelectMenu()) {
        if (interaction.customId !== 'TICKET_MENU::ticket_category') return;
        if (!interaction.message?.author || interaction.message.author.id !== client.user?.id) {
          await interaction.reply({ content: '❗ To menu nie pochodzi od aktualnego bota.', ephemeral: true }).catch(() => {});
          return;
        }
        if (!interaction.guild) {
          await interaction.reply({ content: '❌ Ta akcja musi być wykonana na serwerze.', ephemeral: true }).catch(() => {});
          return;
        }

        const user = interaction.user;
        const selected = interaction.values[0];
        const wantedCategory = selected === 'zakupy' ? 'ZAKUPY' : 'INNE';
        const existingCh = userHasOpenTicketInCategory(interaction.guild, user.id, wantedCategory);
        if (existingCh) {
          await interaction.reply({ content: `❌ Masz już otwarty ticket w tej kategorii: <#${existingCh.id}>.`, ephemeral: true }).catch(() => {});
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

        try {
          await interaction.showModal(modal);
        } catch (err) {
          // 10062 = Unknown interaction (użytkownik za długo czekał)
          if (err?.code === 10062 || err?.rawError?.code === 10062) return;
          console.error('[ticket] showModal error:', err?.message || err);
          await interaction.reply({ content: '❌ Nie udało się otworzyć formularza. Spróbuj ponownie.', ephemeral: true }).catch(() => {});
        }
        return;
      }

      // 2) Modal submit -> tworzymy ticket
      if (interaction.isModalSubmit()) {
        if (!interaction.guild) {
          await interaction.reply({ content: '❌ Ta akcja musi być wykonana na serwerze.', ephemeral: true }).catch(() => {});
          return;
        }
        const parts = interaction.customId.split('::');
        if (parts.length < 3) return;
        const modalType = parts[0];
        const modalTicketNumber = Number(parts[2]) || (++ticketNumberCounter);
        const user = interaction.user;
        const now = new Date();
        const createdDateStr = now.toLocaleString('pl-PL', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });

        let category, channelName, embedFields = [], transactionId = null;

        if (modalType === 'modal_inne') {
          const opis = interaction.fields.getTextInputValue('opis_problem');
          category = 'INNE';
          channelName = `❓|${user.username}`;

          embedFields = [
            { name: `Informacje o użytkowniku:`, value: `Ping: <@${user.id}>\nTAG: ${user.tag}\nID: ${user.id}` },
            { name: `Opis problemu:`, value: `> ${opis}` }
          ];
        } else {
          const produkt = interaction.fields.getTextInputValue('produkt');
          const wydawnictwo = interaction.fields.getTextInputValue('wydawnictwo');
          const platnosc = interaction.fields.getTextInputValue('platnosc');
          category = 'ZAKUPY';
          channelName = `🛒|${user.username}`;
          transactionId = nextTransactionId();

          embedFields = [
            { name: `Informacje o użytkowniku:`, value: `Ping: <@${user.id}>\nTAG: ${user.tag}\nID: ${user.id}` },
            { name: `Informacje o transakcji:`, value: `Transaction ID: ${transactionId}\nKategoria: ${category}\nProdukt: ${produkt}\nWydawnictwo: ${wydawnictwo}\nMetoda płatności: ${platnosc}` }
          ];
        }

        const existingCh = userHasOpenTicketInCategory(interaction.guild, user.id, category);
        if (existingCh) {
          await interaction.reply({ content: `❌ Masz już otwarty ticket w tej kategorii: <#${existingCh.id}>.`, ephemeral: true }).catch(() => {});
          return;
        }

        // Tworzymy kanał z poprawnymi overwrite'ami
        let ticketChannel;
        try {
          const permOverwrites = [
            { id: interaction.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] }, // @everyone
            { id: user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] }
          ];
          if (ADMIN_ROLE_ID) permOverwrites.push({ id: ADMIN_ROLE_ID, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ManageChannels, PermissionsBitField.Flags.ReadMessageHistory] });
          if (MOD_BUTTONS_ROLE_ID) permOverwrites.push({ id: MOD_BUTTONS_ROLE_ID, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.ReadMessageHistory] });

          ticketChannel = await interaction.guild.channels.create({
            name: channelName,
            type: ChannelType.GuildText,
            parent: TICKETS_CATEGORY_ID,
            permissionOverwrites: permOverwrites
          });
        } catch (err) {
          console.error('[ticket] create channel error:', err?.message || err);
          await interaction.reply({ content: '❌ Wystąpił błąd podczas tworzenia kanału ticketowego.', ephemeral: true }).catch(() => {});
          return;
        }

        ticketData.set(ticketChannel.id, {
          ownerId: user.id,
          transactionId,
          ticketNumber: modalTicketNumber,
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

        await interaction.reply({
          embeds: [new EmbedBuilder().setTitle('POMYŚLNIE UTWORZONO TICKET').setDescription(`Twój ticket został utworzony: <#${ticketChannel.id}>`).setColor('Blue').setTimestamp()],
          ephemeral: true
        }).catch(() => {});

        await sendLog('Utworzono ticket', `Utworzono ticket (${category})`, [
          { name: 'Kanał', value: `<#${ticketChannel.id}>` },
          { name: 'Użytkownik', value: `<@${user.id}> (${user.tag})` },
          { name: 'Transaction ID', value: transactionId ? String(transactionId) : 'brak' },
          { name: 'Data utworzenia', value: createdDateStr }
        ], 'Green');

        return;
      }

      // 3) Buttony: close / admin_panel / log_reopen / force_delete
      if (interaction.isButton()) {
        const id = interaction.customId;
        if (!id) return;

        // Zamknięcie ticketu
        if (id.startsWith('close_ticket::')) {
          const [, channelId] = id.split('::');
          try {
            await performClose(channelId, interaction.user.id);
            await interaction.reply({ content: '✅ Ticket został zamknięty i przeniesiony do archiwum.', ephemeral: true }).catch(() => {});
          } catch (err) {
            console.error('[ticket] close handler error:', err?.message || err);
            await interaction.reply({ content: '❌ Błąd podczas zamykania ticketu.', ephemeral: true }).catch(() => {});
          }
          return;
        }

        // Panel admina
        if (id.startsWith('admin_panel::')) {
          const [, channelId] = id.split('::');
          try {
            const tdata = ticketData.get(channelId) || await getTicketData(channelId, interaction.guild);
            const isOwner = tdata?.ownerId === interaction.user.id;
            const member = interaction.member;
            const isMod = member?.roles?.cache?.has(MOD_BUTTONS_ROLE_ID);
            const isAdmin = ADMIN_ROLE_ID ? member?.roles?.cache?.has(ADMIN_ROLE_ID) : false;
            if (!isOwner && !isMod && !isAdmin) {
              await interaction.reply({ content: '❌ Nie masz uprawnień do panelu administracyjnego tego ticketu.', ephemeral: true }).catch(() => {});
              return;
            }

            const adminEmbed = new EmbedBuilder().setTitle('Panel administracyjny').setDescription('Wybierz akcję').setColor('DarkBlue').setTimestamp();
            const adminButtons = new ActionRowBuilder().addComponents(
              new ButtonBuilder().setCustomId(`close_ticket::${channelId}`).setLabel('Zamknij ticket').setStyle(ButtonStyle.Danger),
              new ButtonBuilder().setCustomId(`force_delete::${channelId}`).setLabel('Usuń kanał').setStyle(ButtonStyle.Secondary)
            );
            await interaction.reply({ embeds: [adminEmbed], components: [adminButtons], ephemeral: true }).catch(() => {});
          } catch (err) {
            console.error('[ticket] admin_panel handler error:', err?.message || err);
            await interaction.reply({ content: '❌ Błąd w panelu administracyjnym.', ephemeral: true }).catch(() => {});
          }
          return;
        }

        // Reopen from log
        if (id.startsWith('log_reopen::')) {
          const [, channelId] = id.split('::');
          try {
            const ch = await client.channels.fetch(channelId).catch(() => null);
            if (!ch) {
              await interaction.reply({ content: '❌ Nie znaleziono kanału.', ephemeral: true }).catch(() => {});
              return;
            }
            const stored = ticketData.get(channelId);
            if (stored?.ownerId) {
              await ch.permissionOverwrites.edit(stored.ownerId, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true }).catch(() => {});
            }
            await ch.setParent(TICKETS_CATEGORY_ID).catch(() => {});
            if (stored?.closeTimeoutId) {
              try { clearTimeout(stored.closeTimeoutId); } catch {}
              stored.closeTimeoutId = null;
              ticketData.set(channelId, stored);
            }
            await sendLog('Otworzono ponownie ticket', `Ticket przywrócony z archiwum: <#${channelId}>`, [{ name: 'Przywrócone przez', value: `<@${interaction.user.id}>` }], 'Green');
            await interaction.reply({ content: `✅ Ticket został otworzony ponownie: <#${channelId}>`, ephemeral: true }).catch(() => {});
          } catch (err) {
            console.error('[ticket] log_reopen handler error:', err?.message || err);
            await interaction.reply({ content: '❌ Błąd przy otwieraniu ticketu.', ephemeral: true }).catch(() => {});
          }
          return;
        }

        // Force delete
        if (id.startsWith('force_delete::')) {
          const [, channelId] = id.split('::');
          try {
            const ch = await client.channels.fetch(channelId).catch(() => null);
            if (!ch) {
              await interaction.reply({ content: '❌ Kanał nie istnieje.', ephemeral: true }).catch(() => {});
              return;
            }
            await ch.delete().catch(() => {});
            ticketData.delete(channelId);
            await sendLog('Usunięto ticket (force)', `Kanał usunięty ręcznie przez ${interaction.user.tag}`, [
              { name: 'Kanał', value: `#${ch.name}` },
              { name: 'Użytkownik', value: `<@${interaction.user.id}>` }
            ], 'Grey');
            await interaction.reply({ content: '✅ Kanał został usunięty.', ephemeral: true }).catch(() => {});
          } catch (err) {
            console.error('[ticket] force_delete handler error:', err?.message || err);
            await interaction.reply({ content: '❌ Nie udało się usunąć kanału.', ephemeral: true }).catch(() => {});
          }
          return;
        }
      }
    } catch (err) {
      console.error('[ticket] interaction handler uncaught error:', err?.message || err);
      try {
        if (!interaction.replied && !interaction.deferred) await interaction.reply({ content: '❌ Wystąpił błąd. Skontaktuj się z administracją.', ephemeral: true });
      } catch {}
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