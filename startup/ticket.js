
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

  const DEFAULT_CONFIG = {
    PANEL_CHANNEL_ID: '1454069542283120642',
    TICKET_CATEGORY_OPEN_ID: null,
    TICKET_CATEGORY_ARCHIVE_ID: '1453095347940491464',
    INTERACTIONS_LOG_CHANNEL_ID: '1454210870266695974', // akcje (ban/warn/claim itd.)
    CLOSED_LOG_CHANNEL_ID: '1452581189415338135', // zamknięte tickety + przycisk "Otwórz ponownie"
    OPEN_LIST_CHANNEL_ID: '1313052528761503795', // lista otwartych ticketów
    ADMIN_ROLE_ID: '1321051189848047636',
    BOT_AVATAR_URL:
      'https://cdn.discordapp.com/attachments/1312840154070777889/1453012826334695455/logo_spr.png?ex=694fdba5&is=694e8a25&hm=69388b1cd72462044af4223477b3ba15209a513cc0de17b726112e9f03e5afa3&',
    FOOTER_LOGO_URL:
      'https://media.discordapp.net/attachments/1312840154070777889/1453012826334695455/logo_spr.png?ex=69508465&is=694f32e5&hm=72eb77328a65862a38e21914b70189ed34c8cdc1f9bed4052325fceff87b21a6&=&format=webp&quality=lossless&width=960&height=960',
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
    PANEL_EMBED_TITLE: '💡Wybierz kategrorię:',
  };

  const CONFIG = Object.assign({}, DEFAULT_CONFIG, userConfig);

  // ---------- DB helpers ----------
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

  // ---------- logging utilities ----------
  async function logInteraction(guild, embed) {
    try {
      const ch = await guild.channels.fetch(CONFIG.INTERACTIONS_LOG_CHANNEL_ID).catch(() => null);
      if (!ch) return;
      return ch.send({ embeds: [embed] });
    } catch (e) {
      console.error('logInteraction error', e);
    }
  }

  async function sendOpenListMessage(guild, ticketEntry) {
    try {
      const ch = await guild.channels.fetch(CONFIG.OPEN_LIST_CHANNEL_ID).catch(() => null);
      if (!ch) return null;
      const embed = new EmbedBuilder()
        .setTitle(`Otwarto Ticket #${ticketEntry.id}`)
        .setDescription(`Kanał: <#${ticketEntry.channelId}>\nKategoria: **${ticketEntry.category}**\nUżytkownik: <@${ticketEntry.userId}> (${ticketEntry.userTag || '—'})`)
        .setColor(0x2b8af7)
        .addFields(
          { name: 'Utworzono', value: `<t:${Math.floor(ticketEntry.createdAt / 1000)}:f>`, inline: true },
          { name: 'ID', value: `${ticketEntry.id}`, inline: true }
        )
        .setFooter({ text: 'Lista otwartych ticketów', iconURL: CONFIG.FOOTER_LOGO_URL })
        .setTimestamp();

      const msg = await ch.send({ embeds: [embed] }).catch(() => null);
      return msg;
    } catch (e) {
      console.error('sendOpenListMessage error', e);
      return null;
    }
  }

  async function sendClosedLogMessage(guild, ticketEntry, closedBy) {
    try {
      const ch = await guild.channels.fetch(CONFIG.CLOSED_LOG_CHANNEL_ID).catch(() => null);
      if (!ch) return null;
      const embed = new EmbedBuilder()
        .setTitle(`Zamknięto Ticket #${ticketEntry.id} • ${ticketEntry.category}`)
        .setDescription(`Ticket użytkownika <@${ticketEntry.userId}> został zamknięty przez <@${closedBy}>`)
        .setColor(0xf1c40f)
        .addFields(
          { name: 'Kanał', value: ticketEntry.channelId ? `<#${ticketEntry.channelId}>` : '—', inline: true },
          { name: 'Użytkownik', value: `<@${ticketEntry.userId}>`, inline: true },
          { name: 'ID', value: `${ticketEntry.id}`, inline: true }
        )
        .setFooter({ text: 'Ticket zamknięty', iconURL: CONFIG.FOOTER_LOGO_URL })
        .setTimestamp();

      const reopenBtn = new ButtonBuilder().setCustomId(`reopen_${ticketEntry.channelId}`).setLabel('✅Otwórz ponownie').setStyle(ButtonStyle.Success);
      const row = new ActionRowBuilder().addComponents(reopenBtn);

      const msg = await ch.send({ embeds: [embed], components: [row] }).catch(() => null);
      return msg;
    } catch (e) {
      console.error('sendClosedLogMessage error', e);
      return null;
    }
  }

  // ---------- panel embed & components ----------
  function buildPanelEmbed() {
    return new EmbedBuilder()
      .setTitle(CONFIG.PANEL_EMBED_TITLE)
      .setDescription(
        `${CONFIG.EMOJIS.info} Potrzebujesz pomocy lub kontaktu innego niż zakup? Wybierz kategorię **INNE**\n${CONFIG.EMOJIS.shop} Interesuje Cię zakup np. sprawdzianu/kartkówki? Wybierz kategorię **ZAKUPY**`
      )
      .setColor(0x0b5394)
      .setImage(CONFIG.BOT_AVATAR_URL)
      .setFooter({ text: '© 2025r. Sprawdziany & Kartkówki x Panel Ticketów', iconURL: CONFIG.FOOTER_LOGO_URL });
  }

  function buildPanelComponents() {
    const select = new StringSelectMenuBuilder()
      .setCustomId('ticket_category_select')
      .setPlaceholder('💎Wybierz kategorię!')
      .addOptions(
        new StringSelectMenuOptionBuilder().setLabel('❓INNE').setDescription('Problemy niezwiązane z zakupami').setValue('INNE'),
        new StringSelectMenuOptionBuilder().setLabel('🛒ZAKUPY').setDescription('Zakup np. sprawdzianu/kartkówki').setValue('ZAKUPY')
      );
    return [new ActionRowBuilder().addComponents(select)];
  }

  // send or edit single panel message
  async function sendOrEditPanel(guild) {
    try {
      const channel = await guild.channels.fetch(CONFIG.PANEL_CHANNEL_ID).catch(() => null);
      if (!channel) return null;
      const embed = buildPanelEmbed();
      const components = buildPanelComponents();

      if (db.panelMessageId) {
        const existing = await channel.messages.fetch(db.panelMessageId).catch(() => null);
        if (existing && existing.author && existing.author.id === client.user.id) {
          await existing.edit({ embeds: [embed], components }).catch(() => {});
          return existing;
        } else {
          db.panelMessageId = null;
          saveDB(db);
        }
      }

      const messages = await channel.messages.fetch({ limit: 100 }).catch(() => null);
      if (messages) {
        const botMsg = messages.find(
          (m) => m.author && m.author.id === client.user.id && m.embeds && m.embeds.length && m.embeds[0].title === CONFIG.PANEL_EMBED_TITLE
        );
        if (botMsg) {
          db.panelMessageId = botMsg.id;
          saveDB(db);
          await botMsg.edit({ embeds: [embed], components }).catch(() => {});
          return botMsg;
        }
      }

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

  // ---------- ticket creation (1 per user per category) ----------
  async function createTicketChannel(interaction, category, formData) {
    const guild = interaction.guild;
    const author = interaction.user;

    // Clean and check existing tickets
    for (const [chId, t] of Object.entries(db.tickets || {})) {
      if (t.guildId === guild.id && t.userId === author.id && t.category === category && !t.archivedAt) {
        const existingCh = await guild.channels.fetch(chId).catch(() => null);
        if (existingCh) {
          return { alreadyOpen: true, channel: existingCh, entry: t };
        } else {
          // stale entry: cleanup
          // if there was an open-list message, try delete it
          if (t.openListMessageId) {
            try {
              const openListCh = await guild.channels.fetch(CONFIG.OPEN_LIST_CHANNEL_ID).catch(() => null);
              if (openListCh) await openListCh.messages.fetch(t.openListMessageId).then(m => m.delete()).catch(()=>{});
            } catch {}
          }
          delete db.tickets[chId];
          saveDB(db);
        }
      }
    }

    const ticketId = nextTicketId();
    let channelName;
    if (category === 'ZAKUPY') channelName = `🛒| ${author.username}`.slice(0, 100);
    else channelName = `❓|${author.username}`.slice(0, 100);

    const overwrites = [
      { id: guild.roles.everyone.id, deny: [PermissionsBitField.Flags.ViewChannel] },
      { id: author.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.AttachFiles, PermissionsBitField.Flags.ReadMessageHistory] },
    ];
    if (CONFIG.ADMIN_ROLE_ID) {
      overwrites.push({ id: CONFIG.ADMIN_ROLE_ID, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ManageMessages] });
    }

    const channel = await guild.channels.create({
      name: channelName,
      type: ChannelType.GuildText,
      permissionOverwrites: overwrites,
      parent: CONFIG.TICKET_CATEGORY_OPEN_ID || undefined,
    });

    // store ticket info
    db.tickets[channel.id] = {
      id: ticketId,
      channelId: channel.id,
      userId: author.id,
      userTag: author.tag,
      category,
      form: formData,
      createdAt: Date.now(),
      guildId: guild.id,
    };
    saveDB(db);

    // ticket embed in channel
    const closeButton = new ButtonBuilder().setCustomId(`close_ticket_${channel.id}`).setLabel('Zamknij ticket').setStyle(ButtonStyle.Danger).setEmoji('❌');
    const adminPanelBtn = new ButtonBuilder().setCustomId(`admin_panel_${channel.id}`).setLabel('Panel administracyjny').setStyle(ButtonStyle.Primary).setEmoji('👑');
    const components = [new ActionRowBuilder().addComponents(closeButton, adminPanelBtn)];

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
      embed.addFields(
        { name: 'ID transakcji', value: `${ticketId}`, inline: true },
        { name: 'Kategoria', value: `${category}`, inline: true },
        { name: 'Opis problemu', value: `${formData.opis || '—'}`, inline: false }
      );
    }

    await channel.send({ content: `🔔 <@${author.id}>`, embeds: [embed], components }).catch(() => {});

    // create open-list message
    const openListMsg = await sendOpenListMessage(guild, db.tickets[channel.id]).catch(() => null);
    if (openListMsg) {
      db.tickets[channel.id].openListMessageId = openListMsg.id;
      saveDB(db);
    }

    // log interaction: created
    const createdEmbed = new EmbedBuilder()
      .setTitle('Ticket utworzony')
      .setDescription(`<@${author.id}> utworzył ticket **${category}**`)
      .setColor(0x57f287)
      .addFields({ name: 'Kanał', value: `<#${channel.id}>`, inline: true }, { name: 'ID', value: `${ticketId}`, inline: true })
      .setTimestamp();
    await logInteraction(guild, createdEmbed).catch(() => {});

    return { alreadyOpen: false, channel, entry: db.tickets[channel.id] };
  }

  // ---------- close ticket with creating closed-log + schedule delete ----------
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
        await ch.permissionOverwrites.edit(entry.userId, { SendMessages: false }).catch(() => {});

        entry.archivedAt = Date.now();
        entry.deleteAt = Date.now() + 24 * 60 * 60 * 1000;
        saveDB(db);

        // remove open-list message if exists
        if (entry.openListMessageId) {
          try {
            const openListCh = await guild.channels.fetch(CONFIG.OPEN_LIST_CHANNEL_ID).catch(() => null);
            if (openListCh) {
              const m = await openListCh.messages.fetch(entry.openListMessageId).catch(() => null);
              if (m) await m.delete().catch(() => {});
            }
          } catch {}
          delete entry.openListMessageId;
          saveDB(db);
        }

        // create closed log with reopen button
        const closedMsg = await sendClosedLogMessage(guild, entry, actor.id).catch(() => null);
        if (closedMsg) {
          entry.closedLogMessageId = closedMsg.id;
          saveDB(db);
        }

        // schedule delete
        setTimeout(async () => {
          try {
            const guild = await client.guilds.fetch(entry.guildId);
            const ch = await guild.channels.fetch(channelId).catch(() => null);
            if (ch) await ch.delete('Auto-prune: 24h after closing').catch(() => {});
          } catch (e) {
            console.error('Auto-delete error:', e);
          } finally {
            // optionally delete closed-log message after deletion
            try {
              const closedCh = await client.channels.fetch(CONFIG.CLOSED_LOG_CHANNEL_ID).catch(() => null);
              if (closedCh && entry.closedLogMessageId) {
                await closedCh.messages.fetch(entry.closedLogMessageId).then(m => m.edit({ components: [] })).catch(()=>{});
              }
            } catch {}
            delete db.tickets[channelId];
            saveDB(db);
            await logInteraction(interaction.guild, new EmbedBuilder().setTitle('Ticket usunięty').setDescription(`Ticket #${entry.id} został usunięty po 24h.`).setColor(0x808080).setTimestamp()).catch(() => {});
          }
        }, 24 * 60 * 60 * 1000);

        await logInteraction(interaction.guild, new EmbedBuilder().setTitle('Ticket zamknięty').setDescription(`Ticket #${entry.id} zamknięty przez <@${actor.id}>`).setColor(0xff8a65).setTimestamp()).catch(() => {});
      } catch (e) {
        console.error('closeTicket error:', e);
      }
    }, 5000);
  }

  // reopen ticket (from closed log): move back from archive and restore permissions or recreate channel if deleted
  async function reopenTicket(interaction, channelId) {
    await interaction.deferReply({ ephemeral: true });
    const entry = db.tickets[channelId];
    if (!entry) {
      await interaction.editReply({ content: 'Ticket nieznaleziony w bazie (możliwe że został już usunięty).' });
      return;
    }
    const guild = interaction.guild;
    let ch = await guild.channels.fetch(channelId).catch(() => null);

    if (!ch) {
      // channel was deleted -> create new channel with similar name and re-open it
      const authorId = entry.userId;
      const fakeUser = await client.users.fetch(authorId).catch(() => null);
      const name = entry.category === 'ZAKUPY' ? `🛒| ${fakeUser ? fakeUser.username : 'ticket'}` : `❓|${fakeUser ? fakeUser.username : 'ticket'}`;
      ch = await guild.channels.create({
        name,
        type: ChannelType.GuildText,
        permissionOverwrites: [
          { id: guild.roles.everyone.id, deny: [PermissionsBitField.Flags.ViewChannel] },
          { id: entry.userId, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.AttachFiles, PermissionsBitField.Flags.ReadMessageHistory] },
          { id: CONFIG.ADMIN_ROLE_ID, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ManageMessages] },
        ],
        parent: CONFIG.TICKET_CATEGORY_OPEN_ID || undefined,
      }).catch(() => null);

      if (!ch) {
        await interaction.editReply({ content: 'Nie udało się odtworzyć kanału ticketu.' });
        return;
      }
      // update DB
      entry.channelId = ch.id;
    } else {
      // channel exists: move to open category, restore perms
      if (CONFIG.TICKET_CATEGORY_OPEN_ID) await ch.setParent(CONFIG.TICKET_CATEGORY_OPEN_ID).catch(() => {});
      await ch.permissionOverwrites.edit(entry.userId, { ViewChannel: true, SendMessages: true }).catch(() => {});
    }

    // clear archived and deleteAt
    delete entry.archivedAt;
    delete entry.deleteAt;
    // remove closedLogMessageId (and edit it to disable buttons)
    if (entry.closedLogMessageId) {
      try {
        const closedCh = await client.channels.fetch(CONFIG.CLOSED_LOG_CHANNEL_ID).catch(() => null);
        if (closedCh) {
          const closedMsg = await closedCh.messages.fetch(entry.closedLogMessageId).catch(() => null);
          if (closedMsg) await closedMsg.edit({ components: [] }).catch(() => {});
        }
      } catch {}
      delete entry.closedLogMessageId;
    }

    // create open-list entry again
    entry.openListMessageId = null;
    const openListMsg = await sendOpenListMessage(guild, entry).catch(() => null);
    if (openListMsg) entry.openListMessageId = openListMsg.id;

    saveDB(db);

    await logInteraction(guild, new EmbedBuilder().setTitle('Ticket przywrócony').setDescription(`Ticket #${entry.id} został przywrócony przez <@${interaction.user.id}>`).setColor(0x57f287).setTimestamp()).catch(() => {});

    await interaction.editReply({ content: `Ticket został otworzony ponownie: <#${ch.id}>`, ephemeral: true });
  }

  // ---------- admin actions (ban with modal, warn, summon, etc.) ----------
  async function handleAdminAction(interaction, action, channelId) {
    // For 'ban' we will show modal to ask for reason
    if (action === 'ban' && interaction.isButton()) {
      // show modal
      const modal = new ModalBuilder().setCustomId(`modal_ban_${channelId}`).setTitle('Powód bana');
      const reasonInput = new TextInputBuilder().setCustomId('ban_reason').setLabel('Powód bana (opcjonalny)').setStyle(TextInputStyle.Paragraph).setRequired(false);
      modal.addComponents(new ActionRowBuilder().addComponents(reasonInput));
      await interaction.showModal(modal);
      return;
    }

    await interaction.deferReply({ ephemeral: true });
    const ticket = db.tickets[channelId];
    if (!ticket) {
      await interaction.editReply({ content: 'Ticket nieznaleziony.' });
      return;
    }
    const guild = interaction.guild;
    const actor = interaction.user;
    if (!interaction.member.roles.cache.has(CONFIG.ADMIN_ROLE_ID)) {
      await interaction.editReply({ content: 'Brak uprawnień.' });
      return;
    }
    const targetId = ticket.userId;

    if (action === 'summon') {
      const dm = new EmbedBuilder().setTitle('🔰Wezwanie do ticketa!').setDescription(`Użytkownik <@${actor.id}> wzywa Cię do ticketa❗\nZnajdziesz go tutaj: <#${channelId}>`).setFooter({ text: `❌Wezwanie do ticketa. • ${new Date().toLocaleString()}`, iconURL: CONFIG.BOT_AVATAR_URL });
      client.users.fetch(targetId).then((u) => u.send({ embeds: [dm] }).catch(() => {}));
      await interaction.editReply({ content: `Wysłano wezwanie do <@${targetId}>.` });
      await logInteraction(guild, new EmbedBuilder().setTitle('Wezwanie do ticketa').setDescription(`<@${actor.id}> wezwał <@${targetId}> do ticketu #${ticket.id}`).setColor(0x3498db).setTimestamp());
    } else if (action === 'warn') {
      const dm = new EmbedBuilder().setTitle('⛔Otrzymałeś ostrzeżenie!').setDescription(`Użytkownik <@${actor.id}> ostrzega cię, że jeżeli nie skontaktujesz się na tickecie w przeciągu 24 godzin to twój ticket zostanie zamknięty.`).setFooter({ text: `❗Ostrzeżenie • ${new Date().toLocaleString()}`, iconURL: CONFIG.BOT_AVATAR_URL });
      client.users.fetch(targetId).then((u) => u.send({ embeds: [dm] }).catch(() => {}));
      await interaction.editReply({ content: `Wysłano ostrzeżenie do <@${targetId}>.` });
      await logInteraction(guild, new EmbedBuilder().setTitle('Warn').setDescription(`<@${actor.id}> wysłał warn do <@${targetId}> (ticket #${ticket.id})`).setColor(0xf1c40f).setTimestamp());
    } else if (action === 'claim') {
      ticket.claimedBy = actor.id;
      saveDB(db);
      await interaction.editReply({ content: `Ticket #${ticket.id} przejęty przez <@${actor.id}>.` });
      await logInteraction(guild, new EmbedBuilder().setTitle('Claim').setDescription(`<@${actor.id}> przejął ticket #${ticket.id}`).setColor(0x2ecc71).setTimestamp());
    } else if (action === 'lock') {
      const ch = await guild.channels.fetch(channelId).catch(() => null);
      if (ch) {
        await ch.permissionOverwrites.edit(ticket.userId, { SendMessages: false }).catch(() => {});
        await interaction.editReply({ content: `Ticket #${ticket.id} zablokowany.` });
        await logInteraction(guild, new EmbedBuilder().setTitle('Lock').setDescription(`<@${actor.id}> zablokował ticket #${ticket.id}`).setColor(0x95a5a6).setTimestamp());
      } else {
        await interaction.editReply({ content: 'Kanał nieznaleziony.' });
      }
    } else if (action === 'ban_execute') {
      // ban_execute: data passed as second param (reason)
      // Not used here; handled via modal submit flow below
      await interaction.editReply({ content: 'Wykonano bana.' });
    }
  }

  // ---------- restore deletion timers ----------
  function restoreDeletionTimers() {
    const now = Date.now();
    for (const [channelId, ticket] of Object.entries(db.tickets || {})) {
      if (ticket.deleteAt && typeof ticket.deleteAt === 'number') {
        const ms = ticket.deleteAt - now;
        if (ms <= 0) {
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

  // ---------- event registration (once) ----------
  if (!client._ticketModuleInitialized) {
    client._ticketModuleInitialized = true;

    client.on('ready', async () => {
      try {
        console.log(`[ticket] ready: odtwarzam timery i wysyłam/edytuję panel w kanale ${CONFIG.PANEL_CHANNEL_ID}`);
        restoreDeletionTimers();
        for (const [, guild] of client.guilds.cache) {
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
        // Select menu
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

        // Modal submit for creating tickets or ban reason
        if (interaction.isModalSubmit()) {
          if (interaction.customId === 'modal_INNE' || interaction.customId === 'modal_ZAKUPY') {
            // use deferReply + single editReply so user sees only one embed confirmation
            await interaction.deferReply({ ephemeral: true });
            if (interaction.customId === 'modal_INNE') {
              const opis = interaction.fields.getTextInputValue('opis_problem');
              const res = await createTicketChannel(interaction, 'INNE', { opis });
              if (res.alreadyOpen) {
                const ch = res.channel;
                const alreadyEmbed = new EmbedBuilder().setTitle('Masz już otwarty ticket w tej kategorii').setDescription(ch ? `Masz już otwarty ticket: <#${ch.id}>` : 'Masz już otwarty ticket w tej kategorii.').setColor(0xffcc00).setFooter({ text: '© 2025r. Sprawdziany & Kartkówki', iconURL: CONFIG.FOOTER_LOGO_URL });
                await interaction.editReply({ embeds: [alreadyEmbed] });
              } else {
                const ch = res.channel;
                const successEmbed = new EmbedBuilder().setTitle('✅Utworzono Ticket!').setDescription(`Twój ticket **INNE** został utworzony — znajdziesz go tutaj: <#${ch.id}>`).setColor(0x57f287).setFooter({ text: '© 2025r. Sprawdziany & Kartkówki x Otwarcie Ticketa.', iconURL: CONFIG.FOOTER_LOGO_URL });
                await interaction.editReply({ embeds: [successEmbed] });
              }
            } else {
              const produkt = interaction.fields.getTextInputValue('produkt');
              const wydawnictwo = interaction.fields.getTextInputValue('wydawnictwo') || '—';
              const metoda = interaction.fields.getTextInputValue('metoda') || '—';
              const res = await createTicketChannel(interaction, 'ZAKUPY', { produkt, wydawnictwo, metoda });
              if (res.alreadyOpen) {
                const ch = res.channel;
                const alreadyEmbed = new EmbedBuilder().setTitle('Masz już otwarty ticket w tej kategorii').setDescription(ch ? `Masz już otwarty ticket: <#${ch.id}>` : 'Masz już otwarty ticket w tej kategorii.').setColor(0xffcc00).setFooter({ text: '© 2025r. Sprawdziany & Kartkówki', iconURL: CONFIG.FOOTER_LOGO_URL });
                await interaction.editReply({ embeds: [alreadyEmbed] });
              } else {
                const ch = res.channel;
                const successEmbed = new EmbedBuilder().setTitle('✅Utworzono Ticket!').setDescription(`Twój ticket **ZAKUPY** został utworzony — znajdziesz go tutaj: <#${ch.id}>`).setColor(0x57f287).setFooter({ text: '© 2025r. Sprawdziany & Kartkówki x Otwarcie Ticketa.', iconURL: CONFIG.FOOTER_LOGO_URL });
                await interaction.editReply({ embeds: [successEmbed] });
              }
            }
          } else if (interaction.customId.startsWith('modal_ban_')) {
            // Ban modal submitted -> perform ban and log
            await interaction.deferReply({ ephemeral: true });
            const channelId = interaction.customId.split('modal_ban_')[1];
            const reason = interaction.fields.getTextInputValue('ban_reason') || 'Brak podanego powodu';
            const ticket = db.tickets[channelId];
            if (!ticket) {
              await interaction.editReply({ content: 'Ticket nieznaleziony.' });
              return;
            }
            const guild = interaction.guild;
            const targetId = ticket.userId;
            try {
              await guild.members.ban(targetId, { reason: `Ban z panelu ticketów: ${reason}` });
              await interaction.editReply({ content: `Użytkownik <@${targetId}> został zbanowany. Powód: ${reason}`, ephemeral: true });
              const embed = new EmbedBuilder()
                .setTitle('Akcja: Ban')
                .setDescription(`<@${interaction.user.id}> zbanował <@${targetId}>`)
                .addFields({ name: 'Powód', value: reason, inline: false }, { name: 'Ticket', value: `#${ticket.id}`, inline: true })
                .setColor(0xff4d4f)
                .setTimestamp();
              await logInteraction(guild, embed);
            } catch (e) {
              console.error('Ban error:', e);
              await interaction.editReply({ content: 'Nie udało się zbanować użytkownika (brak uprawnień lub błąd).', ephemeral: true });
            }
          }
        }

        // Buttons handling
        if (interaction.isButton()) {
          const id = interaction.customId;

          // Close ticket
          if (id.startsWith('close_ticket_')) {
            const channelId = id.split('close_ticket_')[1];
            await handleCloseTicket(interaction, channelId);
            return;
          }

          // Admin panel buttons
          if (id.startsWith('admin_panel_')) {
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
            return;
          }

          // Admin action buttons (ban -> open modal, others -> execute)
          if (id.startsWith('admin_ban_')) {
            const channelId = id.split('admin_ban_')[1];
            // show modal to collect reason
            const modal = new ModalBuilder().setCustomId(`modal_ban_${channelId}`).setTitle('Powód bana');
            const reasonInput = new TextInputBuilder().setCustomId('ban_reason').setLabel('Powód bana (opcjonalny)').setStyle(TextInputStyle.Paragraph).setRequired(false);
            modal.addComponents(new ActionRowBuilder().addComponents(reasonInput));
            await interaction.showModal(modal);
            return;
          }
          if (id.startsWith('admin_summon_')) {
            const channelId = id.split('admin_summon_')[1];
            await handleAdminAction(interaction, 'summon', channelId);
            return;
          }
          if (id.startsWith('admin_warn_')) {
            const channelId = id.split('admin_warn_')[1];
            await handleAdminAction(interaction, 'warn', channelId);
            return;
          }
          if (id.startsWith('admin_claim_')) {
            const channelId = id.split('admin_claim_')[1];
            await handleAdminAction(interaction, 'claim', channelId);
            return;
          }
          if (id.startsWith('admin_lock_')) {
            const channelId = id.split('admin_lock_')[1];
            await handleAdminAction(interaction, 'lock', channelId);
            return;
          }

          // Reopen flow
          if (id.startsWith('reopen_')) {
            const channelId = id.split('reopen_')[1];
            // reply ephemeral with confirm buttons
            const confirmRow = new ActionRowBuilder().addComponents(
              new ButtonBuilder().setCustomId(`reopen_yes_${channelId}`).setLabel('✅Tak').setStyle(ButtonStyle.Success),
              new ButtonBuilder().setCustomId(`reopen_no_${channelId}`).setLabel('⛔Nie').setStyle(ButtonStyle.Danger)
            );
            await interaction.reply({ content: 'Czy na pewno chcesz otworzyć ticket ponownie?', components: [confirmRow], ephemeral: true });
            return;
          }
          if (id.startsWith('reopen_yes_')) {
            const channelId = id.split('reopen_yes_')[1];
            await reopenTicket(interaction, channelId);
            return;
          }
          if (id.startsWith('reopen_no_')) {
            await interaction.reply({ content: 'Anulowano ponowne otwarcie.', ephemeral: true });
            return;
          }
        }
      } catch (err) {
        console.error('interactionCreate error:', err);
        try {
          if (!interaction.replied && !interaction.deferred) await interaction.reply({ content: 'Wystąpił błąd.', ephemeral: true });
        } catch {}
      }
    });
  }

  // expose API (opcjonalne)
  return {
    sendOrEditPanel: async () => {
      for (const [, guild] of client.guilds.cache) {
        await sendOrEditPanel(guild);
      }
    },
    getDB: () => db,
    config: CONFIG,
  };
};