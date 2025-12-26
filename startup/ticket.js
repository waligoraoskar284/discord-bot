/**
 * startup/ticket.js (CommonJS)
 *
 * Moduł ticketów dla discord.js v14 — działa po restarcie (Render) i zapewnia,
 * że w kanale panelowym będzie maksymalnie JEDNA wiadomość panelu.
 *
 * Użycie:
 *   const initTicket = require('./startup/ticket');
 *   initTicket(client, { OPTIONAL_CONFIG_OVERRIDES });
 *
 * Przykład (index.js):
 *   const { Client, GatewayIntentBits } = require('discord.js');
 *   const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.GuildMembers] });
 *   const initTicket = require('./startup/ticket');
 *   initTicket(client);
 *   client.login(process.env.DISCORD_TOKEN);
 *
 * Konfiguracja:
 * - Uzupełnij pola w DEFAULT_CONFIG lub przekaż je jako drugi parametr do initTicket.
 *
 * Plik DB: zapisuje tickets.json z strukturą:
 * { lastId, tickets: { channelId: { ... } }, panelMessageId }
 *
 * Wymagane uprawnienia bota:
 * ManageChannels, SendMessages, EmbedLinks, ReadMessageHistory, ManageRoles (jeśli używasz banów), AttachFiles
 */

const fs = require('fs');
const path = require('path');
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  EmbedBuilder,
  PermissionsBitField,
  ChannelType,
} = require('discord.js');

module.exports = function initTicket(client, userConfig = {}) {
  if (!client) throw new Error('Musisz przekazać instancję klienta discord.js: initTicket(client)');

  // ---------------- CONFIG (domyślne, nadpisz przez userConfig)
  const DEFAULT_CONFIG = {
    PANEL_CHANNEL_ID: '1454069542283120642',
    TICKET_CATEGORY_OPEN_ID: null,
    TICKET_CATEGORY_ARCHIVE_ID: '1453095347940491464',
    LOG_CHANNEL_ID: '1454210870266695974',
    ADMIN_ROLE_ID: '1321051189848047636',
    BOT_AVATAR_URL:
      'https://cdn.discordapp.com/attachments/1312840154070777889/1453012826334695455/logo_spr.png?ex=694fdba5&is=694e8a25&hm=69388b1cd72462044af4223477b3ba15209a513cc0de17b726112e9f03e5afa3&',
    EMOJIS: {
      info: '<:info:1452715580456042647>',
      shop: '<:shop:1453054774172975124>',
      user_info: '<:user_info:1453068281979076691>',
      ping: '<:ping:1452951976785481741>',
      tag: '<:tag:1452712046813642905>',
      id_emoji: '<:id:1452715580456042647>',
      txn_info: '<:txn:1452715310095400991>',
    },
    TICKETS_DB_PATH: path.join(__dirname, '..', 'tickets.json'),
    PANEL_EMBED_TITLE: 'Wybierz kategorię',
  };

  const CONFIG = Object.assign({}, DEFAULT_CONFIG, userConfig);

  // ---------------- DB helpers
  function loadDB() {
    try {
      const raw = fs.readFileSync(CONFIG.TICKETS_DB_PATH, 'utf8');
      return JSON.parse(raw);
    } catch {
      return { lastId: 0, tickets: {}, panelMessageId: null };
    }
  }
  function saveDB(db) {
    try {
      fs.writeFileSync(CONFIG.TICKETS_DB_PATH, JSON.stringify(db, null, 2));
    } catch (e) {
      console.error('Nie udało się zapisać DB:', e);
    }
  }
  const db = loadDB();

  function nextTicketId() {
    db.lastId = (db.lastId || 0) + 1;
    saveDB(db);
    return db.lastId;
  }

  // ---------------- Utilities
  async function logAction(guild, embedOrText) {
    try {
      const ch = await guild.channels.fetch(CONFIG.LOG_CHANNEL_ID).catch(() => null);
      if (!ch) return;
      if (typeof embedOrText === 'string') return ch.send({ content: embedOrText });
      return ch.send({ embeds: [embedOrText] });
    } catch (e) {
      console.error('logAction error:', e);
    }
  }

  // Przygotuj embed panelu (używane do wysłania/edycji)
  function buildPanelEmbed() {
    const embed = new EmbedBuilder()
      .setTitle(CONFIG.PANEL_EMBED_TITLE)
      .setDescription(
        `${CONFIG.EMOJIS.info} Potrzebujesz pomocy lub kontaktu innego niż zakup? Wybierz kategorię **INNE**\n${CONFIG.EMOJIS.shop} Interesuje Cię zakup np. sprawdzianu/kartkówki? Wybierz kategorię **ZAKUPY**`
      )
      .setImage(CONFIG.BOT_AVATAR_URL)
      .setColor(0x2f3136)
      .setFooter({ text: 'Wybierz kategorię ticketa...' });

    return embed;
  }

  function buildPanelComponents() {
    const select = new StringSelectMenuBuilder()
      .setCustomId('ticket_category_select')
      .setPlaceholder('Wybierz kategorię ticketu...')
      .addOptions(
        new StringSelectMenuOptionBuilder().setLabel('INNE').setDescription('Problemy niezwiązane z zakupami').setValue('INNE'),
        new StringSelectMenuOptionBuilder().setLabel('ZAKUPY').setDescription('Zakup np. sprawdzianu/kartkówki').setValue('ZAKUPY')
      );
    return [new ActionRowBuilder().addComponents(select)];
  }

  // sendOrEditPanel: zapewnia JEDNĄ wiadomość panelu (persistowana w db.panelMessageId)
  async function sendOrEditPanel(guild) {
    try {
      const channel = await guild.channels.fetch(CONFIG.PANEL_CHANNEL_ID).catch(() => null);
      if (!channel) {
        console.warn(`Nie znaleziono kanału panelu ${CONFIG.PANEL_CHANNEL_ID} w guild ${guild.id}`);
        return null;
      }

      const embed = buildPanelEmbed();
      const components = buildPanelComponents();

      // 1) jeśli mamy zapisane ID wiadomości -> spróbuj edytować
      if (db.panelMessageId) {
        const existing = await channel.messages.fetch(db.panelMessageId).catch(() => null);
        if (existing && existing.author && existing.author.id === client.user.id) {
          await existing.edit({ embeds: [embed], components }).catch(() => {});
          return existing;
        } else {
          // zapisane ID nie istnieje / nie jest wiadomością bota -> wyczyść
          db.panelMessageId = null;
          saveDB(db);
        }
      }

      // 2) jeśli brak zapisanego ID, spróbuj znaleźć wiadomość bota z tym tytułem (na wypadek ręcznego usunięcia ID)
      const messages = await channel.messages.fetch({ limit: 100 }).catch(() => null);
      if (messages) {
        const botMsg = messages.find(
          (m) =>
            m.author &&
            m.author.id === client.user.id &&
            m.embeds &&
            m.embeds.length &&
            m.embeds[0].title === CONFIG.PANEL_EMBED_TITLE
        );
        if (botMsg) {
          db.panelMessageId = botMsg.id;
          saveDB(db);
          await botMsg.edit({ embeds: [embed], components }).catch(() => {});
          return botMsg;
        }
      }

      // 3) jeśli nic nie znaleziono -> wyślij nową wiadomość i zapisz ID
      const sent = await channel.send({ embeds: [embed], components }).catch((e) => {
        console.error('Nie udało się wysłać panelu:', e);
        return null;
      });
      if (sent) {
        db.panelMessageId = sent.id;
        saveDB(db);
      }
      return sent;
    } catch (e) {
      console.error('sendOrEditPanel error', e);
      return null;
    }
  }

  // ---------------- Ticket creation
  async function createTicketChannel(interaction, category, formData) {
    const guild = interaction.guild;
    const author = interaction.user;
    const ticketId = nextTicketId();
    const prefix = category === 'INNE' ? '❓|' : '🛒|';
    const channelName = `${prefix} ${author.username}`.slice(0, 100);

    const overwrites = [
      {
        id: guild.roles.everyone.id,
        deny: [PermissionsBitField.Flags.ViewChannel],
      },
      {
        id: author.id,
        allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.AttachFiles, PermissionsBitField.Flags.ReadMessageHistory],
      },
    ];
    if (CONFIG.ADMIN_ROLE_ID) {
      overwrites.push({
        id: CONFIG.ADMIN_ROLE_ID,
        allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ManageMessages],
      });
    }

    const channel = await guild.channels.create({
      name: channelName,
      type: ChannelType.GuildText,
      permissionOverwrites: overwrites,
      parent: CONFIG.TICKET_CATEGORY_OPEN_ID || undefined,
    });

    db.tickets[channel.id] = {
      id: ticketId,
      userId: author.id,
      category,
      form: formData,
      createdAt: Date.now(),
      guildId: guild.id,
    };
    saveDB(db);

    // Przyciski na kanale ticket
    const closeButton = new ButtonBuilder().setCustomId(`close_ticket_${channel.id}`).setLabel('Zamknij ticket').setStyle(ButtonStyle.Danger).setEmoji('❌');
    const adminPanelBtn = new ButtonBuilder().setCustomId(`admin_panel_${channel.id}`).setLabel('Panel administracyjny').setStyle(ButtonStyle.Primary).setEmoji('👑');
    const components = [new ActionRowBuilder().addComponents(closeButton, adminPanelBtn)];

    // Embed z informacjami
    const embed = new EmbedBuilder()
      .setTitle(`Ticket #${ticketId} | ${category}`)
      .setThumbnail(author.displayAvatarURL({ forceStatic: false }))
      .setColor(category === 'ZAKUPY' ? 0x5865f2 : 0x2f3136)
      .addFields(
        { name: `${CONFIG.EMOJIS.user_info} INFORMACJE O UŻYTKOWNIKU`, value: '\u200B' },
        { name: `${CONFIG.EMOJIS.ping} Ping`, value: `<@${author.id}>`, inline: true },
        { name: `${CONFIG.EMOJIS.tag} TAG`, value: `${author.tag}`, inline: true },
        { name: `${CONFIG.EMOJIS.id_emoji} ID użytkownika`, value: `${author.id}`, inline: true },
        { name: `${CONFIG.EMOJIS.txn_info} INFORMACJE O TRANSAKCJI`, value: '\u200B' }
      )
      .setFooter({ text: `Utworzony przez: ${author.tag} • ${new Date().toLocaleString()}` });

    if (category === 'ZAKUPY') {
      embed.addFields(
        { name: 'ID transakcji', value: `${ticketId}`, inline: true },
        { name: 'Kategoria', value: `${category}`, inline: true },
        { name: 'Produkt', value: `${formData.produkt || '—'}`, inline: false },
        { name: 'Wydawnictwo', value: `${formData.wydawnictwo || '—'}`, inline: true },
        { name: 'Metoda płatności', value: `${formData.metoda || '—'}`, inline: true }
      );
    } else {
      embed.addFields({ name: 'ID transakcji', value: `${ticketId}`, inline: true }, { name: 'Kategoria', value: `${category}`, inline: true }, { name: 'Opis problemu', value: `${formData.opis || '—'}`, inline: false });
    }

    // Wyślij ping + embed
    await channel.send({ content: `🔔 <@${author.id}>`, embeds: [embed], components }).catch(() => {});

    // Log
    await logAction(guild, new EmbedBuilder().setTitle('Ticket otwarty').setDescription(`Ticket #${ticketId} utworzony przez <@${author.id}> w kanale <#${channel.id}>`).setTimestamp()).catch(() => {});

    return channel;
  }

  // ---------------- Close ticket (przenieś do archiwum + planuj usunięcie po 24h)
  async function handleCloseTicket(interaction, channelId) {
    await interaction.deferReply({ ephemeral: true });
    const entry = db.tickets[channelId];
    if (!entry) {
      await interaction.editReply({ content: 'Ticket nieznaleziony w bazie.' });
      return;
    }
    const actor = interaction.user;
    const isAuthor = actor.id === entry.userId;
    const isAdmin = interaction.member.roles.cache.has(CONFIG.ADMIN_ROLE_ID);
    if (!isAuthor && !isAdmin) {
      await interaction.editReply({ content: 'Nie masz uprawnień do zamknięcia tego ticketu.' });
      return;
    }

    const closingEmbed = new EmbedBuilder()
      .setTitle('Zamknięcie nastąpi w przeciągu 5 sekund. Dziękujemy.')
      .setDescription(`❗Ticket został zamknięty przez <@${actor.id}>. Dziękujemy.`)
      .setColor(0xff0000)
      .setFooter({ text: `❌zamknęto ticket. • ${new Date().toLocaleString()}`, iconURL: CONFIG.BOT_AVATAR_URL });

    await interaction.editReply({ embeds: [closingEmbed] });

    setTimeout(async () => {
      try {
        const guild = interaction.guild;
        const ch = await guild.channels.fetch(channelId).catch(() => null);
        if (!ch) return;
        if (CONFIG.TICKET_CATEGORY_ARCHIVE_ID) await ch.setParent(CONFIG.TICKET_CATEGORY_ARCHIVE_ID).catch(() => {});
        // zablokuj pisanie dla właściciela
        await ch.permissionOverwrites.edit(entry.userId, { SendMessages: false }).catch(() => {});

        // ustaw deleteAt i zapisz
        entry.archivedAt = Date.now();
        entry.deleteAt = Date.now() + 24 * 60 * 60 * 1000;
        saveDB(db);

        // ustaw timer usuwania
        setTimeout(async () => {
          try {
            const guild = await client.guilds.fetch(entry.guildId);
            const channel = await guild.channels.fetch(channelId).catch(() => null);
            if (channel) await channel.delete('Auto-prune: 24h after closing').catch(() => {});
          } catch (e) {
            console.error('Auto-delete error:', e);
          } finally {
            delete db.tickets[channelId];
            saveDB(db);
            await logAction(interaction.guild, `Ticket #${entry.id} został usunięty po 24h.`).catch(() => {});
          }
        }, 24 * 60 * 60 * 1000);

        await logAction(interaction.guild, new EmbedBuilder().setTitle('Ticket zamknięty').setDescription(`Ticket #${entry.id} zamknięty przez <@${actor.id}>`).setTimestamp()).catch(() => {});
      } catch (e) {
        console.error('closeTicket error:', e);
      }
    }, 5000);
  }

  // ---------------- Admin actions (ban/summon/warn/claim/lock)
  async function handleAdminAction(interaction, action, channelId) {
    await interaction.deferReply({ ephemeral: true });
    const ticket = db.tickets[channelId];
    if (!ticket) return interaction.editReply({ content: 'Ticket nieznaleziony.' });
    const guild = interaction.guild;
    const actor = interaction.user;
    if (!interaction.member.roles.cache.has(CONFIG.ADMIN_ROLE_ID)) return interaction.editReply({ content: 'Brak uprawnień.' });

    const targetId = ticket.userId;
    if (action === 'ban') {
      guild.members.ban(targetId, { reason: `Ban from ticket by ${actor.tag}` }).catch(() => {});
      await interaction.editReply({ content: `Użytkownik <@${targetId}> został zbanowany.` });
      await logAction(guild, new EmbedBuilder().setTitle('Akcja: Ban').setDescription(`<@${actor.id}> zbanował <@${targetId}> (ticket #${ticket.id})`).setTimestamp());
    } else if (action === 'summon') {
      const dm = new EmbedBuilder().setTitle('🔰Wezwanie do ticketa!').setDescription(`Użytkownik <@${actor.id}> wzywa Cię do ticketa❗\nZnajdziesz go tutaj: <#${channelId}>`).setFooter({ text: `❌Wezwanie do ticketa. • ${new Date().toLocaleString()}`, iconURL: CONFIG.BOT_AVATAR_URL });
      client.users.fetch(targetId).then((u) => u.send({ embeds: [dm] }).catch(() => {}));
      await interaction.editReply({ content: `Wysłano wezwanie do <@${targetId}>.` });
      await logAction(guild, new EmbedBuilder().setTitle('Akcja: Wezwanie').setDescription(`<@${actor.id}> wezwał <@${targetId}> do ticketu #${ticket.id}`).setTimestamp());
    } else if (action === 'warn') {
      const dm = new EmbedBuilder().setTitle('⛔Otrzymałeś ostrzeżenie!').setDescription(`Użytkownik <@${actor.id}> ostrzega cię, że jeżeli nie skontaktujesz się na tickecie w przeciągu 24 godzin to twój ticket zostanie zamknięty.`).setFooter({ text: `❌Wezwanie do ticketa. • ${new Date().toLocaleString()}`, iconURL: CONFIG.BOT_AVATAR_URL });
      client.users.fetch(targetId).then((u) => u.send({ embeds: [dm] }).catch(() => {}));
      await interaction.editReply({ content: `Wysłano ostrzeżenie do <@${targetId}>.` });
      await logAction(guild, new EmbedBuilder().setTitle('Akcja: Warn').setDescription(`<@${actor.id}> wysłał warn do <@${targetId}> (ticket #${ticket.id})`).setTimestamp());
    } else if (action === 'claim') {
      ticket.claimedBy = actor.id;
      saveDB(db);
      await interaction.editReply({ content: `Ticket #${ticket.id} przejęty przez <@${actor.id}>.` });
      await logAction(guild, new EmbedBuilder().setTitle('Akcja: Claim').setDescription(`<@${actor.id}> przejął ticket #${ticket.id}`).setTimestamp());
    } else if (action === 'lock') {
      const ch = await guild.channels.fetch(channelId).catch(() => null);
      if (ch) {
        await ch.permissionOverwrites.edit(ticket.userId, { SendMessages: false }).catch(() => {});
        await interaction.editReply({ content: `Ticket #${ticket.id} zablokowany.` });
        await logAction(guild, new EmbedBuilder().setTitle('Akcja: Lock').setDescription(`<@${actor.id}> zablokował ticket #${ticket.id}`).setTimestamp());
      } else {
        await interaction.editReply({ content: 'Kanał nieznaleziony.' });
      }
    }
  }

  // ---------------- Restore deletion timers (po restarcie)
  function restoreDeletionTimers() {
    const now = Date.now();
    for (const [channelId, ticket] of Object.entries(db.tickets || {})) {
      if (ticket.deleteAt && typeof ticket.deleteAt === 'number') {
        const ms = ticket.deleteAt - now;
        if (ms <= 0) {
          // usuwamy natychmiast (czas minął podczas restartu)
          client.guilds.fetch(ticket.guildId).then((g) => {
            g.channels.fetch(channelId).then((ch) => {
              if (ch) ch.delete('Auto-prune: time passed during restart').catch(() => {});
            }).catch(() => {});
          }).catch(() => {});
          delete db.tickets[channelId];
          saveDB(db);
        } else {
          setTimeout(async () => {
            try {
              const guild = await client.guilds.fetch(ticket.guildId);
              const ch = await guild.channels.fetch(channelId).catch(() => null);
              if (ch) await ch.delete('Auto-prune: 24h after closing').catch(() => {});
            } catch (e) {
              console.error('Error deleting ticket after restore timer:', e);
            } finally {
              delete db.tickets[channelId];
              saveDB(db);
            }
          }, ms);
        }
      }
    }
  }

  // ---------------- Event listeners (rejestrujemy raz)
  if (!client._ticketModuleInitialized) {
    client._ticketModuleInitialized = true;

    client.on('ready', async () => {
      try {
        console.log(`[ticket] ready: odtwarzam timery i wysyłam panel w kanale ${CONFIG.PANEL_CHANNEL_ID}`);
        restoreDeletionTimers();

        // Wyślij lub edytuj panel jedynie w guildach, w których bot jest (jeśli masz wiele guildów)
        for (const [guildId, guild] of client.guilds.cache) {
          try {
            await sendOrEditPanel(guild);
          } catch (e) {
            console.error('sendOrEditPanel per guild error:', e);
          }
        }
      } catch (e) {
        console.error('ticket ready error:', e);
      }
    });

    client.on('interactionCreate', async (interaction) => {
      try {
        // Select menu -> pokaż modal
        if (interaction.isStringSelectMenu() && interaction.customId === 'ticket_category_select') {
          const selected = interaction.values[0];
          if (selected === 'INNE') {
            const modal = new ModalBuilder().setCustomId('modal_INNE').setTitle('Otwórz ticket - INNE');
            const opis = new TextInputBuilder().setCustomId('opis_problem').setLabel('Opisz problem').setStyle(TextInputStyle.Paragraph).setPlaceholder('Np. Mam problem z weryfikacją.').setRequired(true);
            modal.addComponents(new ActionRowBuilder().addComponents(opis));
            await interaction.showModal(modal);
          } else if (selected === 'ZAKUPY') {
            const modal = new ModalBuilder().setCustomId('modal_ZAKUPY').setTitle('Otwórz ticket - ZAKUPY');
            const produkt = new TextInputBuilder().setCustomId('produkt').setLabel('Co chcesz zakupić?').setStyle(TextInputStyle.Short).setPlaceholder('Sprawdzian/Kartkówka lub coś innego').setRequired(true);
            const wydawnictwo = new TextInputBuilder().setCustomId('wydawnictwo').setLabel('Wydawnictwo').setStyle(TextInputStyle.Short).setPlaceholder('Nowa Era, GWO, Mac').setRequired(false);
            const metoda = new TextInputBuilder().setCustomId('metoda').setLabel('Czym będziesz płacił?').setStyle(TextInputStyle.Short).setPlaceholder('Blik, PaysfCard, inne').setRequired(false);
            modal.addComponents(new ActionRowBuilder().addComponents(produkt), new ActionRowBuilder().addComponents(wydawnictwo), new ActionRowBuilder().addComponents(metoda));
            await interaction.showModal(modal);
          }
        }

        // Modal submit -> create ticket
        if (interaction.isModalSubmit()) {
          if (interaction.customId === 'modal_INNE') {
            const opis = interaction.fields.getTextInputValue('opis_problem');
            await interaction.reply({ content: 'Tworzę ticket...', ephemeral: true });
            const ch = await createTicketChannel(interaction, 'INNE', { opis });
            await interaction.editReply({ content: `Ticket utworzony: <#${ch.id}>`, ephemeral: true });
          } else if (interaction.customId === 'modal_ZAKUPY') {
            const produkt = interaction.fields.getTextInputValue('produkt');
            const wydawnictwo = interaction.fields.getTextInputValue('wydawnictwo') || '—';
            const metoda = interaction.fields.getTextInputValue('metoda') || '—';
            await interaction.reply({ content: 'Tworzę ticket...', ephemeral: true });
            const ch = await createTicketChannel(interaction, 'ZAKUPY', { produkt, wydawnictwo, metoda });
            await interaction.editReply({ content: `Ticket utworzony: <#${ch.id}>`, ephemeral: true });
          }
        }

        // Button handling
        if (interaction.isButton()) {
          const id = interaction.customId;
          if (id.startsWith('close_ticket_')) {
            const channelId = id.split('close_ticket_')[1];
            await handleCloseTicket(interaction, channelId);
          } else if (id.startsWith('admin_panel_')) {
            const channelId = id.split('admin_panel_')[1];
            const adminActionsRow = new ActionRowBuilder().addComponents(
              new ButtonBuilder().setCustomId(`admin_ban_${channelId}`).setLabel('❗Ban').setStyle(ButtonStyle.Danger),
              new ButtonBuilder().setCustomId(`admin_summon_${channelId}`).setLabel('🔇Wezwij do ticketa').setStyle(ButtonStyle.Secondary),
              new ButtonBuilder().setCustomId(`admin_warn_${channelId}`).setLabel('🎯Warn').setStyle(ButtonStyle.Primary)
            );
            const extra = new ActionRowBuilder().addComponents(
              new ButtonBuilder().setCustomId(`admin_claim_${channelId}`).setLabel('🛠️Claim').setStyle(ButtonStyle.Success),
              new ButtonBuilder().setCustomId(`admin_lock_${channelId}`).setLabel('🔒Lock').setStyle(ButtonStyle.Secondary)
            );
            await interaction.reply({ content: 'Panel administracyjny:', components: [adminActionsRow, extra], ephemeral: true });
          } else if (id.startsWith('admin_ban_')) {
            const channelId = id.split('admin_ban_')[1];
            await handleAdminAction(interaction, 'ban', channelId);
          } else if (id.startsWith('admin_summon_')) {
            const channelId = id.split('admin_summon_')[1];
            await handleAdminAction(interaction, 'summon', channelId);
          } else if (id.startsWith('admin_warn_')) {
            const channelId = id.split('admin_warn_')[1];
            await handleAdminAction(interaction, 'warn', channelId);
          } else if (id.startsWith('admin_claim_')) {
            const channelId = id.split('admin_claim_')[1];
            await handleAdminAction(interaction, 'claim', channelId);
          } else if (id.startsWith('admin_lock_')) {
            const channelId = id.split('admin_lock_')[1];
            await handleAdminAction(interaction, 'lock', channelId);
          }
        }
      } catch (e) {
        console.error('interactionCreate error:', e);
        try {
          if (!interaction.replied && !interaction.deferred) await interaction.reply({ content: 'Wystąpił błąd.', ephemeral: true });
        } catch {}
      }
    });
  } // koniec if !_ticketModuleInitialized

  // expose API (opcjonalne)
  return {
    sendOrEditPanel: async () => {
      for (const [guildId, guild] of client.guilds.cache) {
        await sendOrEditPanel(guild);
      }
    },
    getDB: () => db,
    config: CONFIG,
  };
};