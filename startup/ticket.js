/**
 * startup/ticket.js (CommonJS)
 *
 * Zmiany/Poprawki:
 * - Transcript: działa jednokrotnie na ticket (jeśli już wygenerowany -> przycisk zwróci info).
 * - Narzędzia ticketa (panel_tickettools) zawierają tylko jedną akcję Transcript (admin_transcript_<id>)
 *   — nie tworzą wielu przycisków tego samego typu.
 * - Przycisk "Archiwizuj" przenosi kanał do kategorii o ID: 1453095347940491464 i zapisuje archivedAt.
 * - Poprawione pola w embedu "INFORMACJE O TRANSAKCJI" używają emoji 1452715310095400991 (nagłówek)
 *   oraz 1453070829285019658 przy każdym wierszu (ID pola, Kategoria, Produkt, Wydawnictwo, Metoda płatności).
 *
 * Użycie: importuj moduł w index.js: const initTicket = require('./startup/ticket'); initTicket(client);
 *
 * Uwaga: zachowano strukturę CommonJS.
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

  const DEFAULT_CONFIG = {
    PANEL_CHANNEL_ID: '1454069542283120642',
    TICKET_CATEGORY_OPEN_ID: '1313052528761503795',
    TICKET_CATEGORY_ARCHIVE_ID: '1453095347940491464', // archiwum -> używane przez "Archiwizuj"
    INTERACTIONS_LOG_CHANNEL_ID: '1454210870266695974',
    CLOSED_LOG_CHANNEL_ID: '1452581189415338135',
    OPEN_LIST_CHANNEL_ID: '1313052528761503795',
    ADMIN_ROLE_ID: '1321051189848047636',
    BOT_AVATAR_URL:
      'https://cdn.discordapp.com/attachments/1312840154070777889/1453012826334695455/logo_spr.png',
    FOOTER_LOGO_URL:
      'https://media.discordapp.net/attachments/1312840154070777889/1453012826334695455/logo_spr.png',
    // EMOJI IDs: header and transaction-field emoji per request
    EMOJI_HEADER_TXN: '<:txn_hdr:1452715310095400991>',
    EMOJI_FIELD_TXN: '<:txn_field:1453070829285019658>',
    // other emojis used previously
    EMOJIS: {
      info: '<:info:1452715580456042647>',
      shop: '<:shop:1453054774172975124>',
      user_info: '<:user_info:1453068281979076691>',
      ping: '<:ping:1452951976785481741>',
      tag: '<:tag:1454522632866369690>',
      id_emoji: '<:idemoji:1454523083292540948>',
      joined: '<:joined:1454523799562096766>',
    },
    TICKETS_DB_PATH: path.join(__dirname, '..', 'tickets.json'),
    PANEL_EMBED_TITLE: '💡Wybierz kategrorię:',
  };

  const CONFIG = Object.assign({}, DEFAULT_CONFIG, userConfig);

  // ---------- DB ----------
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

  // ---------- utilities ----------
  function ts(ms) { return ms ? `<t:${Math.floor(ms/1000)}:f>` : '—'; }
  function dur(startMs, endMs) {
    if (!startMs) return '—';
    const s = Math.floor(( (endMs||Date.now()) - startMs)/1000);
    const h = Math.floor(s/3600), m = Math.floor((s%3600)/60), sec = s%60;
    return `${h}h ${m}m ${sec}s`;
  }

  async function sendLog(guild, embed, ticketChannelId) {
    try {
      const ch = await client.channels.fetch(CONFIG.INTERACTIONS_LOG_CHANNEL_ID).catch(()=>null);
      if (!ch) return;
      // Add two buttons: link to ticket and admin panel for that ticket
      const url = `https://discord.com/channels/${guild.id}/${ticketChannelId}`;
      const urlBtn = new ButtonBuilder().setLabel('Przejdź do ticketa').setStyle(ButtonStyle.Link).setURL(url);
      const adminBtn = new ButtonBuilder().setCustomId(`log_admin_actions_${ticketChannelId}`).setLabel('Panel administracyjny').setStyle(ButtonStyle.Primary);
      const row = new ActionRowBuilder().addComponents(urlBtn, adminBtn);
      return ch.send({ embeds: [embed], components: [row] });
    } catch (e) {
      console.error('sendLog error', e);
    }
  }

  // ---------- panel (unchanged) ----------
  function buildPanelEmbed() {
    return new EmbedBuilder()
      .setTitle(CONFIG.PANEL_EMBED_TITLE)
      .setDescription(`${CONFIG.EMOJIS.info} Potrzebujesz pomocy lub kontaktu innego niż zakup? Wybierz kategorię **INNE**\n${CONFIG.EMOJIS.shop} Interesuje Cię zakup np. sprawdzianu/kartkówki? Wybierz kategorię **ZAKUPY**`)
      .setColor(0x0b5394)
      .setImage(CONFIG.BOT_AVATAR_URL)
      .setFooter({ text: '© 2025r. Sprawdziany & Kartkówki x Panel Ticketów', iconURL: CONFIG.FOOTER_LOGO_URL });
  }
  function buildPanelComponents() {
    const select = new StringSelectMenuBuilder()
      .setCustomId('ticket_category_select')
      .setPlaceholder('💎Wybierz kategorię!')
      .addOptions(
        { label: '❓INNE', description: 'Problemy niezwiązane z zakupami', value: 'INNE' },
        { label: '🛒ZAKUPY', description: 'Zakup np. sprawdzianu/kartkówki', value: 'ZAKUPY' },
      );
    return [new ActionRowBuilder().addComponents(select)];
  }

  async function sendOrEditPanel(guild) {
    try {
      const ch = await guild.channels.fetch(CONFIG.PANEL_CHANNEL_ID).catch(()=>null);
      if (!ch) return;
      const embed = buildPanelEmbed();
      const comps = buildPanelComponents();
      if (db.panelMessageId) {
        const existing = await ch.messages.fetch(db.panelMessageId).catch(()=>null);
        if (existing && existing.author && existing.author.id === client.user.id) {
          await existing.edit({ embeds: [embed], components: comps }).catch(()=>{});
          return existing;
        } else { db.panelMessageId = null; saveDB(db); }
      }
      const messages = await ch.messages.fetch({ limit: 100 }).catch(()=>null);
      if (messages) {
        const botMsg = messages.find(m => m.author && m.author.id === client.user.id && m.embeds && m.embeds.length && m.embeds[0].title === CONFIG.PANEL_EMBED_TITLE);
        if (botMsg) { db.panelMessageId = botMsg.id; saveDB(db); await botMsg.edit({ embeds: [embed], components: comps }).catch(()=>{}); return botMsg; }
      }
      const sent = await ch.send({ embeds: [embed], components: comps }).catch(e=>{ console.error('send panel error', e); return null; });
      if (sent) { db.panelMessageId = sent.id; saveDB(db); }
      return sent;
    } catch (e) { console.error('sendOrEditPanel error', e); return null; }
  }

  // ---------- ticket embed builder (with requested emoji fields) ----------
  async function buildTicketEmbed(guild, user, ticketId, category, form) {
    let member = null;
    try { member = await guild.members.fetch(user.id).catch(()=>null); } catch {}
    const joined = member && member.joinedAt ? member.joinedAt.toLocaleString('pl-PL') : '—';

    const embed = new EmbedBuilder()
      .setTitle(category.toUpperCase())
      .setThumbnail(user.displayAvatarURL({ forceStatic: false }))
      .setColor(category === 'ZAKUPY' ? 0x5865f2 : 0x2f3136);

    // User info
    const userInfo = [
      `> ${CONFIG.EMOJIS.ping} **Ping:** <@${user.id}>`,
      `> ${CONFIG.EMOJIS.tag} **Tag:** ${user.tag}`,
      `> ${CONFIG.EMOJIS.id_emoji} **ID Użytkownika:** ${user.id}`,
      `> ${CONFIG.EMOJIS.joined} **Data dołączenia na serwer:** ${joined}`,
    ].join('\n');
    embed.addFields({ name: `${CONFIG.EMOJIS.user_info} **INFORMACJE O UŻYTKOWNIKU:**`, value: userInfo });

    // Transaction header uses CONFIG.EMOJI_HEADER_TXN
    if (category === 'ZAKUPY') {
      const txnLines = [
        `> ${CONFIG.EMOJI_FIELD_TXN} **ID transakcji:** ${ticketId}`,
        `> ${CONFIG.EMOJI_FIELD_TXN} **Kategoria:** ${category}`,
        `> ${CONFIG.EMOJI_FIELD_TXN} **Produkt:** ${form.produkt || '—'}`,
        `> ${CONFIG.EMOJI_FIELD_TXN} **Wydawnictwo:** ${form.wydawnictwo || '—'}`,
        `> ${CONFIG.EMOJI_FIELD_TXN} **Metoda płatności:** ${form.metoda || '—'}`,
      ].join('\n');
      embed.addFields({ name: `${CONFIG.EMOJI_HEADER_TXN} **INFORMACJE O TRANSAKCJI:**`, value: txnLines });
    } else {
      const helpLines = [
        `> ${CONFIG.EMOJI_FIELD_TXN} **ID ticketa:** ${ticketId}`,
        `> ${CONFIG.EMOJI_FIELD_TXN} **Kategoria:** ${category}`,
        `> ${CONFIG.EMOJI_FIELD_TXN} **Opis problemu:** ${form.opis || '—'}`,
      ].join('\n');
      embed.addFields({ name: `${CONFIG.EMOJI_HEADER_TXN} **INFORMACJE O POMOCY:**`, value: helpLines });
    }

    embed.setFooter({ text: '© 2025r. Sprawdziany & Kartkówki x Ticket', iconURL: CONFIG.FOOTER_LOGO_URL });
    return embed;
  }

  // ---------- create ticket (1 per category) ----------
  async function createTicketChannel(interaction, category, formData) {
    const guild = interaction.guild;
    const author = interaction.user;

    // enforce single open per user/category
    for (const [chId,t] of Object.entries(db.tickets || {})) {
      if (t.guildId === guild.id && t.userId === author.id && t.category === category && !t.archivedAt) {
        const existing = await guild.channels.fetch(chId).catch(()=>null);
        if (existing) return { alreadyOpen: true, channel: existing, entry: t };
        if (t.openListMessageId) { try { const open = await client.channels.fetch(CONFIG.OPEN_LIST_CHANNEL_ID).catch(()=>null); if (open) await open.messages.fetch(t.openListMessageId).then(m=>m.delete()).catch(()=>{}); } catch {} }
        delete db.tickets[chId]; saveDB(db);
      }
    }

    const ticketId = nextTicketId();
    const channelName = category === 'ZAKUPY' ? `🛒| ${author.username}`.slice(0,100) : `❓|${author.username}`.slice(0,100);

    const overwrites = [
      { id: guild.roles.everyone.id, deny: [PermissionsBitField.Flags.ViewChannel] },
      { id: author.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.AttachFiles, PermissionsBitField.Flags.ReadMessageHistory] },
    ];
    if (CONFIG.ADMIN_ROLE_ID) overwrites.push({ id: CONFIG.ADMIN_ROLE_ID, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ManageMessages] });

    const channel = await guild.channels.create({
      name: channelName,
      type: ChannelType.GuildText,
      permissionOverwrites: overwrites,
      parent: CONFIG.TICKET_CATEGORY_OPEN_ID || undefined,
    });

    db.tickets[channel.id] = {
      id: ticketId,
      channelId: channel.id,
      userId: author.id,
      userTag: author.tag,
      category,
      form: formData,
      createdAt: Date.now(),
      guildId: guild.id,
      transcriptGenerated: false, // transcript flag
    };
    saveDB(db);

    // Buttons: close + admin panel (admin-only use enforced later)
    const closeBtn = new ButtonBuilder().setCustomId(`close_ticket_${channel.id}`).setLabel('Zamknij ticket').setStyle(ButtonStyle.Danger).setEmoji('❌');
    const adminBtn = new ButtonBuilder().setCustomId(`admin_panel_${channel.id}`).setLabel('Panel administracyjny').setStyle(ButtonStyle.Primary).setEmoji('👑');
    const components = [ new ActionRowBuilder().addComponents(closeBtn, adminBtn) ];

    const embed = await buildTicketEmbed(guild, author, ticketId, category, formData);
    await channel.send({ content: `🔔 <@${author.id}>`, embeds: [embed], components }).catch(()=>{});

    // open-list
    try {
      const openCh = await client.channels.fetch(CONFIG.OPEN_LIST_CHANNEL_ID).catch(()=>null);
      if (openCh) {
        const openEmbed = new EmbedBuilder().setTitle(`Otwarto Ticket #${ticketId}`).setDescription(`Kanał: <#${channel.id}>\nKategoria: **${category}**\nUżytkownik: <@${author.id}>`).setColor(0x2b8af7).addFields({ name: 'Utworzono', value: `<t:${Math.floor(Date.now()/1000)}:f>`, inline: true }, { name: 'ID', value: `${ticketId}`, inline: true }).setFooter({ text: 'Lista otwartych ticketów', iconURL: CONFIG.FOOTER_LOGO_URL }).setTimestamp();
        const m = await openCh.send({ embeds: [openEmbed] }).catch(()=>null);
        if (m) { db.tickets[channel.id].openListMessageId = m.id; saveDB(db); }
      }
    } catch (e) { console.error('open list error', e); }

    // log creation
    const createdLog = new EmbedBuilder().setTitle('Ticket utworzony').setColor(0x57f287).setDescription(`<@${author.id}> utworzył ticket **${category}** (#${ticketId})`).addFields({ name: 'Kanał', value: `<#${channel.id}>`, inline: true }, { name: 'Użytkownik', value: `${author.tag} (${author.id})`, inline: true }).setTimestamp();
    await sendLog(interaction.guild, createdLog, channel.id).catch(()=>{});

    return { alreadyOpen: false, channel, entry: db.tickets[channel.id] };
  }

  // ---------- close ticket (admin only for button) ----------
  async function handleCloseTicket(interaction, channelId) {
    await interaction.deferReply({ ephemeral: true });
    const entry = db.tickets[channelId];
    if (!entry) { await interaction.editReply({ content: 'Ticket nieznaleziony.' }); return; }
    // restrict close action to admin role
    if (!interaction.member.roles.cache.has(CONFIG.ADMIN_ROLE_ID)) { await interaction.editReply({ content: 'Tylko administracja może zamykać tickety.' }); return; }

    const actor = interaction.user;
    const info = new EmbedBuilder().setTitle('Zamykanie ticketu').setDescription(`Ticket zostanie zamknięty przez <@${actor.id}>`).setColor(0xff0000).setTimestamp();
    await interaction.editReply({ embeds: [info] });

    setTimeout(async () => {
      try {
        const guild = interaction.guild;
        const ch = await guild.channels.fetch(channelId).catch(()=>null);
        if (ch && CONFIG.TICKET_CATEGORY_ARCHIVE_ID) await ch.setParent(CONFIG.TICKET_CATEGORY_ARCHIVE_ID).catch(()=>null);
        if (ch) await ch.permissionOverwrites.edit(entry.userId, { SendMessages: false }).catch(()=>null);

        entry.archivedAt = Date.now();
        entry.deleteAt = Date.now() + 24*60*60*1000;
        saveDB(db);

        // remove open-list msg
        if (entry.openListMessageId) {
          try { const openCh = await client.channels.fetch(CONFIG.OPEN_LIST_CHANNEL_ID).catch(()=>null); if (openCh) { const m = await openCh.messages.fetch(entry.openListMessageId).catch(()=>null); if (m) await m.delete().catch(()=>{}); } } catch {}
          delete entry.openListMessageId; saveDB(db);
        }

        // closed log with reopen button
        const closedCh = await client.channels.fetch(CONFIG.CLOSED_LOG_CHANNEL_ID).catch(()=>null);
        if (closedCh) {
          const closedEmbed = new EmbedBuilder().setTitle(`Zamknięto Ticket #${entry.id} • ${entry.category}`).setDescription(`Ticket użytkownika <@${entry.userId}> został zamknięty przez <@${actor.id}>`).setColor(0xf1c40f).addFields(
            { name: 'Kanał', value: entry.channelId ? `<#${entry.channelId}>` : '—', inline: true },
            { name: 'Użytkownik', value: `<@${entry.userId}>`, inline: true },
            { name: 'Ticket ID', value: `${entry.id}`, inline: true },
            { name: 'Utworzono', value: ts(entry.createdAt), inline: true },
            { name: 'Zamknięto', value: ts(entry.archivedAt), inline: true },
            { name: 'Czas otwarty', value: dur(entry.createdAt, entry.archivedAt), inline: true }
          ).setFooter({ text: 'Ticket zamknięty', iconURL: CONFIG.FOOTER_LOGO_URL }).setTimestamp();
          const reopenBtn = new ButtonBuilder().setCustomId(`reopen_${entry.channelId}`).setLabel('✅Otwórz ponownie').setStyle(ButtonStyle.Success);
          const row = new ActionRowBuilder().addComponents(reopenBtn);
          const sent = await closedCh.send({ embeds: [closedEmbed], components: [row] }).catch(()=>null);
          if (sent) { entry.closedLogMessageId = sent.id; saveDB(db); }
        }

        const logEmbed = new EmbedBuilder().setTitle('Ticket zamknięty').setDescription(`Ticket #${entry.id} zamknięty przez <@${actor.id}>`).setColor(0xff8a65).addFields({ name: 'Kanał', value: entry.channelId ? `<#${entry.channelId}>` : '—', inline: true }, { name: 'Użytkownik', value: `<@${entry.userId}>`, inline: true }, { name: 'Czas otwarty', value: dur(entry.createdAt, entry.archivedAt), inline: true }).setTimestamp();
        await sendLog(interaction.guild, logEmbed, entry.channelId).catch(()=>{});

        // schedule delete in 24h
        setTimeout(async ()=> {
          try {
            const guild = await client.guilds.fetch(entry.guildId);
            const ch = await guild.channels.fetch(channelId).catch(()=>null);
            if (ch) await ch.delete('Auto-prune after 24h').catch(()=>null);
          } catch(e) { console.error('auto delete error', e); } finally {
            try { if (entry.closedLogMessageId) { const closedCh2 = await client.channels.fetch(CONFIG.CLOSED_LOG_CHANNEL_ID).catch(()=>null); if (closedCh2) { const m = await closedCh2.messages.fetch(entry.closedLogMessageId).catch(()=>null); if (m) await m.edit({ components: [] }).catch(()=>{}); } } } catch {}
            delete db.tickets[channelId]; saveDB(db);
          }
        }, 24*60*60*1000);

      } catch (e) { console.error('handleCloseTicket error', e); }
    }, 5000);
  }

  // ---------- Archive button (separate) ----------
  async function handleArchiveTicket(interaction, channelId) {
    // allow admin only
    if (!interaction.member.roles.cache.has(CONFIG.ADMIN_ROLE_ID)) { await interaction.reply({ content: 'Tylko administracja może archiwizować.', ephemeral: true }); return; }
    const entry = db.tickets[channelId];
    if (!entry) { await interaction.reply({ content: 'Ticket nieznaleziony.', ephemeral: true }); return; }
    try {
      const guild = interaction.guild;
      const ch = await guild.channels.fetch(channelId).catch(()=>null);
      if (!ch) { await interaction.reply({ content: 'Kanał nieznaleziony.', ephemeral: true }); return; }
      await ch.setParent(CONFIG.TICKET_CATEGORY_ARCHIVE_ID).catch(()=>null);
      entry.archivedAt = Date.now();
      entry.deleteAt = Date.now() + 24*60*60*1000;
      saveDB(db);
      await interaction.reply({ content: `Ticket #${entry.id} przeniesiony do archiwum.`, ephemeral: true });
      const logEmbed = new EmbedBuilder().setTitle('Ticket zarchiwizowany').setDescription(`Ticket #${entry.id} przeniesiono do archiwum przez <@${interaction.user.id}>`).setColor(0x95a5a6).addFields({ name: 'Kanał', value: `<#${channelId}>`, inline: true }, { name: 'Użytkownik', value: `<@${entry.userId}>`, inline: true }).setTimestamp();
      await sendLog(interaction.guild, logEmbed, channelId);
    } catch (e) {
      console.error('handleArchiveTicket error', e);
      await interaction.reply({ content: 'Błąd archiwizacji.', ephemeral: true });
    }
  }

  // ---------- Transcript: single-run ----------
  async function handleTranscript(interaction, channelId) {
    // admin only
    if (!interaction.member.roles.cache.has(CONFIG.ADMIN_ROLE_ID)) { await interaction.reply({ content: 'Tylko administracja.', ephemeral: true }); return; }
    const entry = db.tickets[channelId];
    if (!entry) { await interaction.reply({ content: 'Ticket nieznaleziony.', ephemeral: true }); return; }
    if (entry.transcriptGenerated) { await interaction.reply({ content: 'Transcript został już wygenerowany dla tego ticketu.', ephemeral: true }); return; }

    await interaction.deferReply({ ephemeral: true });
    try {
      // simple transcript: fetch last 200 messages from channel and save as txt
      const guild = interaction.guild;
      const ch = await guild.channels.fetch(channelId).catch(()=>null);
      if (!ch) { await interaction.editReply({ content: 'Kanał nie znaleziony.' }); return; }

      const messages = await ch.messages.fetch({ limit: 200 }).catch(()=>null);
      let lines = [];
      if (messages) {
        const arr = Array.from(messages.values()).reverse();
        for (const m of arr) {
          const time = new Date(m.createdTimestamp).toLocaleString('pl-PL');
          const author = `${m.author.tag} (${m.author.id})`;
          const content = m.content || (m.attachments && m.attachments.size ? `[attachment: ${Array.from(m.attachments.values()).map(a=>a.url).join(', ')}]` : '');
          lines.push(`[${time}] ${author}: ${content}`);
        }
      }
      const txt = lines.join('\n');
      // save as file and send as ephemeral attachment
      const filename = `transcript-ticket-${entry.id}.txt`;
      await interaction.editReply({ content: 'Transcript wygenerowany — wysyłam plik (ephemeral)...', files: [{ attachment: Buffer.from(txt, 'utf8'), name: filename }], ephemeral: true }).catch(()=>{});
      entry.transcriptGenerated = true;
      entry.transcriptAt = Date.now();
      saveDB(db);
      // log transcript generation
      const logEmbed = new EmbedBuilder().setTitle('Transcript wygenerowany').setDescription(`Transcript dla ticketu #${entry.id} wygenerowany przez <@${interaction.user.id}>`).setColor(0x2b8af7).addFields({ name: 'Kanał', value: `<#${channelId}>`, inline: true }, { name: 'Użytkownik', value: `<@${entry.userId}>`, inline: true }, { name: 'Wygenerowano', value: ts(Date.now()), inline: true }).setTimestamp();
      await sendLog(interaction.guild, logEmbed, channelId);
    } catch (e) {
      console.error('transcript error', e);
      try { await interaction.editReply({ content: 'Błąd generowania transcriptu.', ephemeral: true }); } catch {}
    }
  }

  // ---------- event registration ----------
  if (!client._ticketModuleInitialized) {
    client._ticketModuleInitialized = true;

    client.on('ready', async () => {
      console.log('[ticket] ready');
      // restore timers for auto-deletes
      const now = Date.now();
      for (const [cid, t] of Object.entries(db.tickets || {})) {
        if (t.deleteAt && t.deleteAt > now) {
          const ms = t.deleteAt - now;
          setTimeout(async () => {
            try {
              const guild = await client.guilds.fetch(t.guildId);
              const ch = await guild.channels.fetch(cid).catch(()=>null);
              if (ch) await ch.delete('Auto-prune after 24h').catch(()=>null);
            } catch (e) { console.error('restore auto-delete error', e); } finally { delete db.tickets[cid]; saveDB(db); }
          }, ms);
        } else if (t.deleteAt && t.deleteAt <= now) {
          // expired -> delete if exists
          (async ()=> {
            try { const guild = await client.guilds.fetch(t.guildId); const ch = await guild.channels.fetch(cid).catch(()=>null); if (ch) await ch.delete('Auto-prune after restart').catch(()=>null); } catch {} finally { delete db.tickets[cid]; saveDB(db); }
          })();
        }
      }

      for (const [, guild] of client.guilds.cache) {
        await sendOrEditPanel(guild).catch(()=>null);
      }
    });

    client.on('interactionCreate', async (interaction) => {
      try {
        // select menu
        if (interaction.isStringSelectMenu() && interaction.customId === 'ticket_category_select') {
          const sel = interaction.values[0];
          if (sel === 'INNE') {
            const modal = new ModalBuilder().setCustomId('modal_INNE').setTitle('Otwórz ticket - INNE');
            const opis = new TextInputBuilder().setCustomId('opis_problem').setLabel('Opisz problem').setStyle(TextInputStyle.Paragraph).setPlaceholder('Np. Mam problem z weryfikacją.').setRequired(true);
            modal.addComponents(new ActionRowBuilder().addComponents(opis));
            await interaction.showModal(modal);
            return;
          } else if (sel === 'ZAKUPY') {
            const modal = new ModalBuilder().setCustomId('modal_ZAKUPY').setTitle('Otwórz ticket - ZAKUPY');
            const produkt = new TextInputBuilder().setCustomId('produkt').setLabel('Co chcesz zakupić?').setStyle(TextInputStyle.Short).setPlaceholder('Sprawdzian/Kartkówka lub coś innego').setRequired(true);
            const wydawnictwo = new TextInputBuilder().setCustomId('wydawnictwo').setLabel('Wydawnictwo').setStyle(TextInputStyle.Short).setPlaceholder('Nowa Era, GWO, Mac').setRequired(false);
            const metoda = new TextInputBuilder().setCustomId('metoda').setLabel('Czym będziesz płacił?').setStyle(TextInputStyle.Short).setPlaceholder('Blik, PaysfCard, inne').setRequired(false);
            modal.addComponents(new ActionRowBuilder().addComponents(produkt), new ActionRowBuilder().addComponents(wydawnictwo), new ActionRowBuilder().addComponents(metoda));
            await interaction.showModal(modal);
            return;
          }
        }

        // modal submit
        if (interaction.isModalSubmit()) {
          if (interaction.customId === 'modal_INNE' || interaction.customId === 'modal_ZAKUPY') {
            await interaction.deferReply({ ephemeral: true });
            if (interaction.customId === 'modal_INNE') {
              const opis = interaction.fields.getTextInputValue('opis_problem');
              const res = await createTicketChannel(interaction, 'INNE', { opis });
              if (res.alreadyOpen) {
                const ch = res.channel;
                const embed = new EmbedBuilder().setTitle('Masz już otwarty ticket w tej kategorii').setDescription(ch ? `Masz już otwarty ticket: <#${ch.id}>` : 'Masz już otwarty ticket w tej kategorii.').setColor(0xffcc00).setFooter({ text: '© 2025r. Sprawdziany & Kartkówki', iconURL: CONFIG.FOOTER_LOGO_URL });
                await interaction.editReply({ embeds: [embed] });
              } else {
                const ch = res.channel;
                const embed = new EmbedBuilder().setTitle('✅Utworzono Ticket!').setDescription(`Twój ticket **INNE** został utworzony — znajdziesz go tutaj: <#${ch.id}>`).setColor(0x57f287).setFooter({ text: '© 2025r. Sprawdziany & Kartkówki x Otwarcie Ticketa.', iconURL: CONFIG.FOOTER_LOGO_URL });
                await interaction.editReply({ embeds: [embed] });
              }
            } else {
              const produkt = interaction.fields.getTextInputValue('produkt');
              const wydawnictwo = interaction.fields.getTextInputValue('wydawnictwo') || '—';
              const metoda = interaction.fields.getTextInputValue('metoda') || '—';
              const res = await createTicketChannel(interaction, 'ZAKUPY', { produkt, wydawnictwo, metoda });
              if (res.alreadyOpen) {
                const ch = res.channel;
                const embed = new EmbedBuilder().setTitle('Masz już otwarty ticket w tej kategorii').setDescription(ch ? `Masz już otwarty ticket: <#${ch.id}>` : 'Masz już otwarty ticket w tej kategorii.').setColor(0xffcc00).setFooter({ text: '© 2025r. Sprawdziany & Kartkówki', iconURL: CONFIG.FOOTER_LOGO_URL });
                await interaction.editReply({ embeds: [embed] });
              } else {
                const ch = res.channel;
                const embed = new EmbedBuilder().setTitle('✅Utworzono Ticket!').setDescription(`Twój ticket **ZAKUPY** został utworzony — znajdziesz go tutaj: <#${ch.id}>`).setColor(0x57f287).setFooter({ text: '© 2025r. Sprawdziany & Kartkówki x Otwarcie Ticketa.', iconURL: CONFIG.FOOTER_LOGO_URL });
                await interaction.editReply({ embeds: [embed] });
              }
            }
            return;
          }

          // admin modals (ban/warn/mute/kick/note) handled earlier in code paths (modal IDs: modal_ban_, modal_warn_, modal_mute_, modal_kick_, modal_note_)
          // see modal handlers in previous versions (kept compatible)
        }

        // button handling
        if (interaction.isButton()) {
          const id = interaction.customId;

          // close ticket (admin only)
          if (id.startsWith('close_ticket_')) {
            const channelId = id.split('close_ticket_')[1];
            await handleCloseTicket(interaction, channelId);
            return;
          }

          // admin panel top-level
          if (id.startsWith('admin_panel_')) {
            const channelId = id.split('admin_panel_')[1];
            if (!interaction.member.roles.cache.has(CONFIG.ADMIN_ROLE_ID)) { await interaction.reply({ content: 'Tylko administracja.', ephemeral: true }); return; }
            const groupRow = new ActionRowBuilder().addComponents(
              new ButtonBuilder().setCustomId(`panel_useractions_${channelId}`).setLabel('Działania na użytkowniku').setStyle(ButtonStyle.Primary),
              new ButtonBuilder().setCustomId(`panel_tickettools_${channelId}`).setLabel('Narzędzia ticketa').setStyle(ButtonStyle.Secondary)
            );
            const extraRow = new ActionRowBuilder().addComponents(
              new ButtonBuilder().setCustomId(`panel_note_${channelId}`).setLabel('Dodaj notatkę').setStyle(ButtonStyle.Success),
              new ButtonBuilder().setCustomId(`panel_transcript_${channelId}`).setLabel('Transcript').setStyle(ButtonStyle.Secondary)
            );
            await interaction.reply({ content: 'Panel administracyjny — wybierz:', components: [groupRow, extraRow], ephemeral: true });
            return;
          }

          // panel_useractions
          if (id.startsWith('panel_useractions_')) {
            const channelId = id.split('panel_useractions_')[1];
            if (!interaction.member.roles.cache.has(CONFIG.ADMIN_ROLE_ID)) { await interaction.reply({ content: 'Tylko administracja.', ephemeral: true }); return; }
            const row = new ActionRowBuilder().addComponents(
              new ButtonBuilder().setCustomId(`admin_ban_${channelId}`).setLabel('❗Ban').setStyle(ButtonStyle.Danger),
              new ButtonBuilder().setCustomId(`admin_mute_${channelId}`).setLabel('🔇Mute').setStyle(ButtonStyle.Secondary),
              new ButtonBuilder().setCustomId(`admin_kick_${channelId}`).setLabel('👢Kick').setStyle(ButtonStyle.Danger),
              new ButtonBuilder().setCustomId(`admin_warn_${channelId}`).setLabel('🎯Warn').setStyle(ButtonStyle.Primary),
              new ButtonBuilder().setCustomId(`admin_summon_${channelId}`).setLabel('🔔Wezwij (DM)').setStyle(ButtonStyle.Primary)
            );
            const extra = new ActionRowBuilder().addComponents(
              new ButtonBuilder().setCustomId(`admin_claim_${channelId}`).setLabel('🛡️Claim').setStyle(ButtonStyle.Success),
              new ButtonBuilder().setCustomId(`admin_lock_${channelId}`).setLabel('🔒Lock').setStyle(ButtonStyle.Secondary)
            );
            await interaction.reply({ content: 'Działania na użytkowniku:', components: [row, extra], ephemeral: true });
            return;
          }

          // panel_tickettools (ensure single transcript button only)
          if (id.startsWith('panel_tickettools_')) {
            const channelId = id.split('panel_tickettools_')[1];
            if (!interaction.member.roles.cache.has(CONFIG.ADMIN_ROLE_ID)) { await interaction.reply({ content: 'Tylko administracja.', ephemeral: true }); return; }
            const ticket = db.tickets[channelId];
            if (!ticket) { await interaction.reply({ content: 'Ticket nieznaleziony.', ephemeral: true }); return; }
            // single transcript button (admin_transcript_<channelId>), archive, export, lock view
            const transcriptBtn = new ButtonBuilder().setCustomId(`admin_transcript_${channelId}`).setLabel(ticket.transcriptGenerated ? 'Transcript (wygenerowany)' : 'Transcript').setStyle(ButtonStyle.Secondary).setDisabled(false);
            const archiveBtn = new ButtonBuilder().setCustomId(`admin_archive_${channelId}`).setLabel('Archiwizuj').setStyle(ButtonStyle.Secondary).setEmoji('🗂️');
            const exportBtn = new ButtonBuilder().setCustomId(`admin_export_${channelId}`).setLabel('Export JSON').setStyle(ButtonStyle.Primary);
            const moreRow = new ActionRowBuilder().addComponents(transcriptBtn, archiveBtn, exportBtn);
            await interaction.reply({ content: 'Narzędzia ticketa:', components: [moreRow], ephemeral: true });
            return;
          }

          // admin_transcript: run once per ticket
          if (id.startsWith('admin_transcript_')) {
            const channelId = id.split('admin_transcript_')[1];
            await handleTranscript(interaction, channelId);
            return;
          }

          // archive button
          if (id.startsWith('admin_archive_')) {
            const channelId = id.split('admin_archive_')[1];
            await handleArchiveTicket(interaction, channelId);
            return;
          }

          // export JSON
          if (id.startsWith('admin_export_')) {
            const channelId = id.split('admin_export_')[1];
            if (!interaction.member.roles.cache.has(CONFIG.ADMIN_ROLE_ID)) { await interaction.reply({ content: 'Tylko administracja.', ephemeral: true }); return; }
            const ticket = db.tickets[channelId];
            if (!ticket) { await interaction.reply({ content: 'Ticket nieznaleziony.', ephemeral: true }); return; }
            const content = JSON.stringify(ticket, null, 2);
            await interaction.reply({ content: 'Export ticketu (JSON):', files: [{ attachment: Buffer.from(content, 'utf8'), name: `ticket-${ticket.id}.json` }], ephemeral: true }).catch(()=>{});
            const log = new EmbedBuilder().setTitle('Export JSON').setDescription(`Export ticketu #${ticket.id} wykonany przez <@${interaction.user.id}>`).setColor(0x2b8af7).setTimestamp();
            await sendLog(interaction.guild, log, ticket.channelId);
            return;
          }

          // admin_ban_/admin_warn_/admin_mute_/admin_kick_ handled above with modals (displayed)
          // For completeness: handle panel buttons that trigger modals / actions
          if (id.startsWith('admin_ban_') || id.startsWith('admin_warn_') || id.startsWith('admin_mute_') || id.startsWith('admin_kick_') || id.startsWith('panel_note_')) {
            // these are already handled elsewhere: show modals
            // But ensure behavior: if modal is to be shown, do it here (consistent)
            if (id.startsWith('admin_ban_')) {
              const channelId = id.split('admin_ban_')[1];
              const modal = new ModalBuilder().setCustomId(`modal_ban_${channelId}`).setTitle('Powód bana');
              modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('ban_reason').setLabel('Powód bana (opcjonalny)').setStyle(TextInputStyle.Paragraph).setRequired(false)));
              await interaction.showModal(modal);
              return;
            }
            if (id.startsWith('admin_warn_')) {
              const channelId = id.split('admin_warn_')[1];
              const modal = new ModalBuilder().setCustomId(`modal_warn_${channelId}`).setTitle('Powód warna');
              modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('warn_reason').setLabel('Powód').setStyle(TextInputStyle.Paragraph).setRequired(false)));
              await interaction.showModal(modal);
              return;
            }
            if (id.startsWith('admin_mute_')) {
              const channelId = id.split('admin_mute_')[1];
              const modal = new ModalBuilder().setCustomId(`modal_mute_${channelId}`).setTitle('Mute (minuty|powód)');
              modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('mute_payload').setLabel('Format: <minuty> | <powód>').setStyle(TextInputStyle.Short).setRequired(true)));
              await interaction.showModal(modal);
              return;
            }
            if (id.startsWith('admin_kick_')) {
              const channelId = id.split('admin_kick_')[1];
              const modal = new ModalBuilder().setCustomId(`modal_kick_${channelId}`).setTitle('Powód kicka');
              modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('kick_reason').setLabel('Powód').setStyle(TextInputStyle.Paragraph).setRequired(false)));
              await interaction.showModal(modal);
              return;
            }
            if (id.startsWith('panel_note_')) {
              const channelId = id.split('panel_note_')[1];
              const modal = new ModalBuilder().setCustomId(`modal_note_${channelId}`).setTitle('Dodaj notatkę');
              modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('note_text').setLabel('Notatka').setStyle(TextInputStyle.Paragraph).setRequired(true)));
              await interaction.showModal(modal);
              return;
            }
          }

          // log-admin-actions from logs -> show admin panel ephemeral (already handled earlier)
          if (id.startsWith('log_admin_actions_')) {
            const channelId = id.split('log_admin_actions_')[1];
            // reuse panel opener flow
            if (!interaction.member.roles.cache.has(CONFIG.ADMIN_ROLE_ID)) { await interaction.reply({ content: 'Tylko administracja.', ephemeral: true }); return; }
            const groupRow = new ActionRowBuilder().addComponents(
              new ButtonBuilder().setCustomId(`panel_useractions_${channelId}`).setLabel('Działania na użytkowniku').setStyle(ButtonStyle.Primary),
              new ButtonBuilder().setCustomId(`panel_tickettools_${channelId}`).setLabel('Narzędzia ticketa').setStyle(ButtonStyle.Secondary)
            );
            await interaction.reply({ content: 'Panel administracyjny (z logu):', components: [groupRow], ephemeral: true });
            return;
          }

          // reopen flow (yes/no)
          if (id.startsWith('reopen_')) {
            const channelId = id.split('reopen_')[1];
            const confirmRow = new ActionRowBuilder().addComponents(
              new ButtonBuilder().setCustomId(`reopen_yes_${channelId}`).setLabel('✅Tak').setStyle(ButtonStyle.Success),
              new ButtonBuilder().setCustomId(`reopen_no_${channelId}`).setLabel('⛔Nie').setStyle(ButtonStyle.Danger)
            );
            await interaction.reply({ content: 'Czy na pewno chcesz otworzyć ticket ponownie?', components: [confirmRow], ephemeral: true });
            return;
          }
          if (id.startsWith('reopen_yes_')) {
            const channelId = id.split('reopen_yes_')[1];
            // handle simple reopen (similar to previous implementation)
            await interaction.deferReply({ ephemeral: true });
            const entry = db.tickets[channelId];
            if (!entry) { await interaction.editReply({ content: 'Ticket nieznaleziony.' }); return; }
            const guild = interaction.guild;
            let ch = await guild.channels.fetch(channelId).catch(()=>null);
            if (ch) { if (CONFIG.TICKET_CATEGORY_OPEN_ID) await ch.setParent(CONFIG.TICKET_CATEGORY_OPEN_ID).catch(()=>null); await ch.permissionOverwrites.edit(entry.userId, { ViewChannel: true, SendMessages: true }).catch(()=>null); }
            else {
              const userObj = await client.users.fetch(entry.userId).catch(()=>null);
              const name = entry.category === 'ZAKUPY' ? `🛒| ${userObj ? userObj.username : 'ticket'}` : `❓|${userObj ? userObj.username : 'ticket'}`;
              ch = await guild.channels.create({ name, type: ChannelType.GuildText, permissionOverwrites: [
                { id: guild.roles.everyone.id, deny: [PermissionsBitField.Flags.ViewChannel] },
                { id: entry.userId, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.AttachFiles, PermissionsBitField.Flags.ReadMessageHistory] },
                { id: CONFIG.ADMIN_ROLE_ID, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ManageMessages] },
              ], parent: CONFIG.TICKET_CATEGORY_OPEN_ID || undefined }).catch(()=>null);
              if (ch) entry.channelId = ch.id;
            }
            delete entry.archivedAt; delete entry.deleteAt;
            // create open-list again
            try {
              const openCh = await client.channels.fetch(CONFIG.OPEN_LIST_CHANNEL_ID).catch(()=>null);
              if (openCh) {
                const openEmbed = new EmbedBuilder().setTitle(`Przywrócono Ticket #${entry.id}`).setDescription(`Kanał: <#${entry.channelId}>\nKategoria: **${entry.category}**\nUżytkownik: <@${entry.userId}>`).setColor(0x2b8af7).addFields({ name: 'Przywrócono', value: `<t:${Math.floor(Date.now()/1000)}:f>`, inline: true }, { name: 'ID', value: `${entry.id}`, inline: true }).setFooter({ text: 'Lista otwartych ticketów', iconURL: CONFIG.FOOTER_LOGO_URL }).setTimestamp();
                const m = await openCh.send({ embeds: [openEmbed] }).catch(()=>null);
                if (m) entry.openListMessageId = m.id;
              }
            } catch (e) {}
            saveDB(db);
            const logEmbed = new EmbedBuilder().setTitle('Ticket przywrócony').setDescription(`Ticket #${entry.id} został przywrócony przez <@${interaction.user.id}>`).setColor(0x57f287).addFields({ name: 'Kanał', value: `<#${entry.channelId}>`, inline: true }, { name: 'Użytkownik', value: `<@${entry.userId}>`, inline: true }).setTimestamp();
            await sendLog(interaction.guild, logEmbed, entry.channelId);
            await interaction.editReply({ content: `Ticket #${entry.id} został otworzony ponownie: <#${entry.channelId}>`, ephemeral: true });
            return;
          }
          if (id.startsWith('reopen_no_')) {
            const channelId = id.split('reopen_no_')[1];
            // handle "no" action -> send light red embed to closed log
            const ticket = db.tickets[channelId];
            const closedCh = await client.channels.fetch(CONFIG.CLOSED_LOG_CHANNEL_ID).catch(()=>null);
            const userText = ticket && ticket.userId ? `<@${ticket.userId}>` : 'użytkownika';
            if (closedCh) {
              const redEmbed = new EmbedBuilder().setTitle('❌Ticket **nie** zostanie ponownie otwarty').setDescription(`Ticket ${userText} nie zostanie ponownie otwarty.`).setColor(0xff6b6b).setFooter({ text: '© 2025r. Sprawdziany & Kartkówki x Ponowne Otwarcie Ticketa.', iconURL: CONFIG.FOOTER_LOGO_URL }).setTimestamp();
              await closedCh.send({ embeds: [redEmbed] }).catch(()=>null);
            }
            const logEmbed = new EmbedBuilder().setTitle('Ponowne otwarcie anulowane').setDescription(`<@${interaction.user.id}> anulował ponowne otwarcie ticketu ${ticket ? `#${ticket.id}` : ''}`).setColor(0xff6b6b).setTimestamp();
            await sendLog(interaction.guild, logEmbed, channelId);
            await interaction.reply({ content: 'Anulowano ponowne otwarcie. Informacja wysłana do logów.', ephemeral: true });
            return;
          }

        } // end isButton

      } catch (err) {
        console.error('interactionCreate error', err);
        try { if (!interaction.replied && !interaction.deferred) await interaction.reply({ content: 'Wystąpił błąd.', ephemeral: true }); } catch {}
      }
    });
  } // end if initialized

  // expose API
  return {
    sendOrEditPanel,
    getDB: () => db,
    config: CONFIG,
  };
};