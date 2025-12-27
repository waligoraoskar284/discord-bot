/**
 * startup/ticket.js (CommonJS)
 *
 * Zmiany:
 * - Przycisk "Zamknij ticket" oraz "Panel administracyjny" mogą używać tylko osoby z rolą ADMIN_ROLE_ID.
 *   (Możesz zmienić to zachowanie w kodzie jeśli chcesz dopuścić autora do zamknięcia.)
 * - Panel administracyjny jest teraz zorganizowany: najpierw "Działania na użytkowniku" / "Narzędzia ticketa" / dodatkowe akcje.
 *   "Działania na użytkowniku" otwiera podmenu z 7 operacjami: Ban, Mute (timeout), Kick, Warn, Summon (DM), Claim, Lock.
 * - Ban/ Warn/ Mute/ Kick korzystają z modalów (gdzie potrzebny jest powód / czas).
 * - Po wykonaniu akcji logi wysyłane są do kan. INTERACTIONS_LOG_CHANNEL_ID z 7+ informacyjnymi polami oraz dwoma przyciskami:
 *     - "Przejdź do ticketa" (link bezpośredni)
 *     - "Akcje na tym tickecie" (ephemeral panel admina dla danego ticketu)
 *
 * Wskazówki:
 * - Wgraj plik do startup/ticket.js, zrestartuj bota.
 * - Upewnij się, że bot ma wymagane uprawnienia (ManageChannels, BanMembers, ModerateMembers, SendMessages, EmbedLinks itp.).
 *
 * Uwaga: plik zawiera pełną implementację eventów interactionCreate, modali i logów.
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
    TICKET_CATEGORY_OPEN_ID: '1313052528761503795', // wszystkie otwarte tickety tu
    TICKET_CATEGORY_ARCHIVE_ID: '1453095347940491464',
    INTERACTIONS_LOG_CHANNEL_ID: '1454210870266695974', // logi akcji
    CLOSED_LOG_CHANNEL_ID: '1452581189415338135',
    OPEN_LIST_CHANNEL_ID: '1313052528761503795',
    ADMIN_ROLE_ID: '1321051189848047636',
    BOT_AVATAR_URL:
      'https://cdn.discordapp.com/attachments/1312840154070777889/1453012826334695455/logo_spr.png?ex=694fdba5&is=694e8a25&hm=69388b1cd72462044af4223477b3ba15209a513cc0de17b726112e9f03e5afa3&',
    FOOTER_LOGO_URL:
      'https://media.discordapp.net/attachments/1312840154070777889/1453012826334695455/logo_spr.png?ex=69512d25&is=694fdba5&hm=c21e8b77adb5fa5ef441aed3fe8cbb624f5919938964ccc6aefde3b1bf6f2ee4&=&format=webp&quality=lossless&width=960&height=960',
    EMOJIS: {
      info: '<:info:1452715580456042647>',
      shop: '<:shop:1453054774172975124>',
      user_info: '<:user_info:1453068281979076691>',
      ping: '<:ping:1452951976785481741>',
      tag: '<:tag:1454522632866369690>',
      id_emoji: '<:idemoji:1454523083292540948>',
      joined: '<:joined:1454523799562096766>',
      txn_info: '<:txn:1452715310095400991>',
      txn_field: '<:txnf:1453070829285019658>',
    },
    TICKETS_DB_PATH: path.join(__dirname, '..', 'tickets.json'),
    PANEL_EMBED_TITLE: '💡Wybierz kategrorię:',
  };

  const CONFIG = Object.assign({}, DEFAULT_CONFIG, userConfig);

  // ---- DB helpers ----
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

  // ---- Utilities / Log builder ----
  function timestampFmt(ms) {
    if (!ms) return '—';
    return `<t:${Math.floor(ms / 1000)}:f>`;
  }
  function durationStr(startMs, endMs) {
    if (!startMs) return '—';
    const end = endMs || Date.now();
    const s = Math.floor((end - startMs) / 1000);
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    return `${h}h ${m}m ${sec}s`;
  }

  function buildActionLog({ action, moderatorId, targetId, ticket, channelId, reason, extraFields = {} }) {
    const colorMap = {
      ban: 0xff4d4f, warn: 0xf1c40f, summon: 0x3498db, claim: 0x2ecc71, lock: 0x95a5a6, mute: 0xff8a65, kick: 0xff6b6b,
      create: 0x57f287, close: 0xff8a65, reopen: 0x2b8af7,
    };
    const titleMap = {
      ban: 'Akcja: Ban', warn: 'Warn', summon: 'Wezwanie', claim: 'Claim', lock: 'Lock', mute: 'Mute', kick: 'Kick',
      create: 'Ticket utworzony', close: 'Ticket zamknięty', reopen: 'Ticket przywrócony'
    };
    const embed = new EmbedBuilder()
      .setTitle(titleMap[action] || action)
      .setColor(colorMap[action] || 0x2f3136)
      .setTimestamp()
      .setFooter({ text: 'Dziennik działań • Sprawdziany & Kartkówki', iconURL: CONFIG.FOOTER_LOGO_URL });

    // required fields (7+)
    embed.addFields(
      { name: 'Akcja', value: `${titleMap[action] || action}`, inline: true },
      { name: 'Moderator', value: moderatorId ? `<@${moderatorId}> (${moderatorId})` : '—', inline: true },
      { name: 'Cel', value: targetId ? `<@${targetId}> (${targetId})` : '—', inline: true },
      { name: 'Ticket ID', value: ticket ? `${ticket.id}` : '—', inline: true },
      { name: 'Kanał', value: channelId ? `<#${channelId}>` : (ticket ? (ticket.channelId ? `<#${ticket.channelId}>` : '—') : '—'), inline: true },
      { name: 'Kategoria', value: ticket ? (ticket.category || '—') : '—', inline: true },
      { name: 'Utworzono', value: ticket ? timestampFmt(ticket.createdAt) : '—', inline: true },
    );

    // Additional useful fields
    if (reason) embed.addFields({ name: 'Powód', value: reason.toString().slice(0, 1024), inline: false });
    if (ticket && ticket.claimedBy) embed.addFields({ name: 'Przejęty przez', value: `<@${ticket.claimedBy}>`, inline: true });
    embed.addFields({ name: 'Czas trwania', value: ticket ? durationStr(ticket.createdAt, ticket.archivedAt) : '—', inline: true });

    // attach extra fields if provided
    for (const [k, v] of Object.entries(extraFields || {})) {
      embed.addFields({ name: k, value: String(v).slice(0, 1024), inline: false });
    }

    return embed;
  }

  async function sendInteractionLog(guild, embed, ticketChannelId) {
    try {
      const logCh = await client.channels.fetch(CONFIG.INTERACTIONS_LOG_CHANNEL_ID).catch(() => null);
      if (!logCh) return;
      // add buttons: Link do ticketa + panel admina (ephemeral)
      const components = [];
      const url = `https://discord.com/channels/${guild.id}/${ticketChannelId}`;
      const urlBtn = new ButtonBuilder().setLabel('Przejdź do ticketa').setStyle(ButtonStyle.Link).setURL(url);
      const panelBtn = new ButtonBuilder().setCustomId(`log_admin_actions_${ticketChannelId}`).setLabel('Akcje na tym tickecie').setStyle(ButtonStyle.Primary);
      const row = new ActionRowBuilder().addComponents(urlBtn, panelBtn);
      return logCh.send({ embeds: [embed], components: [row] });
    } catch (e) {
      console.error('sendInteractionLog error', e);
    }
  }

  // ---- Panel embed / Select ----
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
        new StringSelectMenuOptionBuilder().setLabel('❓INNE').setDescription('Problemy niezwiązane z zakupami').setValue('INNE'),
        new StringSelectMenuOptionBuilder().setLabel('🛒ZAKUPY').setDescription('Zakup np. sprawdzianu/kartkówki').setValue('ZAKUPY')
      );
    return [new ActionRowBuilder().addComponents(select)];
  }
  async function sendOrEditPanel(guild) {
    try {
      const ch = await guild.channels.fetch(CONFIG.PANEL_CHANNEL_ID).catch(() => null);
      if (!ch) return;
      const embed = buildPanelEmbed();
      const components = buildPanelComponents();
      if (db.panelMessageId) {
        const existing = await ch.messages.fetch(db.panelMessageId).catch(() => null);
        if (existing && existing.author && existing.author.id === client.user.id) {
          await existing.edit({ embeds: [embed], components }).catch(() => {});
          return existing;
        } else {
          db.panelMessageId = null;
          saveDB(db);
        }
      }
      const msgs = await ch.messages.fetch({ limit: 100 }).catch(() => null);
      if (msgs) {
        const botMsg = msgs.find(m => m.author && m.author.id === client.user.id && m.embeds && m.embeds.length && m.embeds[0].title === CONFIG.PANEL_EMBED_TITLE);
        if (botMsg) {
          db.panelMessageId = botMsg.id;
          saveDB(db);
          await botMsg.edit({ embeds: [embed], components }).catch(() => {});
          return botMsg;
        }
      }
      const sent = await ch.send({ embeds: [embed], components }).catch(e => { console.error('send panel error', e); return null; });
      if (sent) { db.panelMessageId = sent.id; saveDB(db); }
      return sent;
    } catch (e) { console.error('sendOrEditPanel error', e); return null; }
  }

  // ---- Ticket embed builder (user requested layout) ----
  async function buildTicketEmbed(guild, user, ticketId, category, form) {
    let member = null;
    try { member = await guild.members.fetch(user.id).catch(() => null); } catch {}
    const joinedStr = member && member.joinedAt ? member.joinedAt.toLocaleString('pl-PL') : '—';

    const e = new EmbedBuilder()
      .setTitle(category.toUpperCase())
      .setThumbnail(user.displayAvatarURL({ forceStatic: false }))
      .setColor(category === 'ZAKUPY' ? 0x5865f2 : 0x2f3136);

    const emoji = CONFIG.EMOJIS;

    // User info field
    const userInfo = [
      `> ${emoji.ping} **Ping:** <@${user.id}>`,
      `> ${emoji.tag} **Tag:** ${user.tag}`,
      `> ${emoji.id_emoji} **ID Użytkownika:** ${user.id}`,
      `> ${emoji.joined} **Data dołączenia na serwer:** ${joinedStr}`,
    ].join('\n');
    e.addFields({ name: `${emoji.user_info} **INFORMACJE O UŻYTKOWNIKU:**`, value: userInfo });

    // Transaction or help info
    if (category === 'ZAKUPY') {
      const txn = [
        `> ${emoji.txn_field} **ID transakcji:** ${ticketId}`,
        `> ${emoji.txn_field} **Kategoria:** ${category}`,
        `> ${emoji.txn_field} **Produkt:** ${form.produkt || '—'}`,
        `> ${emoji.txn_field} **Wydawnictwo:** ${form.wydawnictwo || '—'}`,
        `> ${emoji.txn_field} **Metoda płatności:** ${form.metoda || '—'}`,
      ].join('\n');
      e.addFields({ name: `${emoji.txn_info} **INFORMACJE O TRANSAKCJI:**`, value: txn });
    } else {
      const help = [
        `> ${emoji.txn_field} **ID ticketa:** ${ticketId}`,
        `> ${emoji.txn_field} **Kategoria:** ${category}`,
        `> ${emoji.txn_field} **Opis problemu:** ${form.opis || '—'}`,
      ].join('\n');
      e.addFields({ name: `${emoji.txn_info} **INFORMACJE O POMOCY:**`, value: help });
    }

    e.setFooter({ text: '© 2025r. Sprawdziany & Kartkówki x Ticket', iconURL: CONFIG.FOOTER_LOGO_URL });
    return e;
  }

  // ---- Create ticket (1 per category) ----
  async function createTicketChannel(interaction, category, formData) {
    const guild = interaction.guild;
    const author = interaction.user;

    // enforce single open per user/category
    for (const [chId, t] of Object.entries(db.tickets || {})) {
      if (t.guildId === guild.id && t.userId === author.id && t.category === category && !t.archivedAt) {
        const existing = await guild.channels.fetch(chId).catch(() => null);
        if (existing) return { alreadyOpen: true, channel: existing, entry: t };
        // stale -> cleanup
        if (t.openListMessageId) {
          try { const openCh = await client.channels.fetch(CONFIG.OPEN_LIST_CHANNEL_ID).catch(() => null); if (openCh) await openCh.messages.fetch(t.openListMessageId).then(m => m.delete()).catch(()=>{}); } catch {}
        }
        delete db.tickets[chId];
        saveDB(db);
      }
    }

    const ticketId = nextTicketId();
    const channelName = category === 'ZAKUPY' ? `🛒| ${author.username}`.slice(0, 100) : `❓|${author.username}`.slice(0, 100);

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
    };
    saveDB(db);

    // Buttons: (close + admin panel). We will restrict the use to ADMIN_ROLE_ID.
    const closeBtn = new ButtonBuilder().setCustomId(`close_ticket_${channel.id}`).setLabel('Zamknij ticket').setStyle(ButtonStyle.Danger).setEmoji('❌');
    const adminBtn = new ButtonBuilder().setCustomId(`admin_panel_${channel.id}`).setLabel('Panel administracyjny').setStyle(ButtonStyle.Primary).setEmoji('👑');
    const components = [ new ActionRowBuilder().addComponents(closeBtn, adminBtn) ];

    const embed = await buildTicketEmbed(guild, author, ticketId, category, formData);
    // send ping + embed
    await channel.send({ content: `🔔 <@${author.id}>`, embeds: [embed], components }).catch(() => {});

    // update open-list
    try {
      const openCh = await client.channels.fetch(CONFIG.OPEN_LIST_CHANNEL_ID).catch(() => null);
      if (openCh) {
        const openEmbed = new EmbedBuilder()
          .setTitle(`Otwarto Ticket #${ticketId}`)
          .setDescription(`Kanał: <#${channel.id}>\nKategoria: **${category}**\nUżytkownik: <@${author.id}>`)
          .setColor(0x2b8af7)
          .addFields({ name: 'Utworzono', value: `<t:${Math.floor(Date.now()/1000)}:f>`, inline: true }, { name: 'ID', value: `${ticketId}`, inline: true })
          .setFooter({ text: 'Lista otwartych ticketów', iconURL: CONFIG.FOOTER_LOGO_URL })
          .setTimestamp();
        const m = await openCh.send({ embeds: [openEmbed] }).catch(()=>null);
        if (m) { db.tickets[channel.id].openListMessageId = m.id; saveDB(db); }
      }
    } catch (e) { console.error('open list error', e); }

    // interaction log: created
    const createdLog = buildActionLog({ action: 'create', moderatorId: interaction.user.id, targetId: author.id, ticket: db.tickets[channel.id], channelId: channel.id });
    await sendInteractionLog(interaction.guild, createdLog, channel.id).catch(() => {});

    return { alreadyOpen: false, channel, entry: db.tickets[channel.id] };
  }

  // ---- Close ticket (only admin allowed per request) ----
  async function handleCloseTicket(interaction, channelId) {
    await interaction.deferReply({ ephemeral: true });
    const entry = db.tickets[channelId];
    if (!entry) { await interaction.editReply({ content: 'Ticket nieznaleziony.' }); return; }
    // restrict: only admin role can close now
    if (!interaction.member.roles.cache.has(CONFIG.ADMIN_ROLE_ID)) {
      await interaction.editReply({ content: 'Tylko administracja może używać tego przycisku.' });
      return;
    }

    const actor = interaction.user;
    const closingEmbed = new EmbedBuilder().setTitle('Zamknięcie nastąpi w przeciągu 5 sekund. Dziękujemy.').setDescription(`❗Ticket zostanie zamknięty przez <@${actor.id}>`).setColor(0xff0000).setFooter({ text: `❌zamknięto ticket. • ${new Date().toLocaleString()}`, iconURL: CONFIG.BOT_AVATAR_URL });
    await interaction.editReply({ embeds: [closingEmbed] });

    setTimeout(async () => {
      try {
        const guild = interaction.guild;
        const ch = await guild.channels.fetch(channelId).catch(()=>null);
        if (ch && CONFIG.TICKET_CATEGORY_ARCHIVE_ID) await ch.setParent(CONFIG.TICKET_CATEGORY_ARCHIVE_ID).catch(()=>null);
        if (ch) await ch.permissionOverwrites.edit(entry.userId, { SendMessages: false }).catch(()=>null);

        entry.archivedAt = Date.now();
        entry.deleteAt = Date.now() + 24*60*60*1000;
        saveDB(db);

        // remove open-list message
        if (entry.openListMessageId) {
          try {
            const openListCh = await client.channels.fetch(CONFIG.OPEN_LIST_CHANNEL_ID).catch(()=>null);
            if (openListCh) { const m = await openListCh.messages.fetch(entry.openListMessageId).catch(()=>null); if (m) await m.delete().catch(()=>{}); }
          } catch {}
          delete entry.openListMessageId; saveDB(db);
        }

        // closed log with reopen button
        const closedMsg = await (async ()=> {
          try {
            const chc = await client.channels.fetch(CONFIG.CLOSED_LOG_CHANNEL_ID).catch(()=>null);
            if (!chc) return null;
            const embed = new EmbedBuilder()
              .setTitle(`Zamknięto Ticket #${entry.id} • ${entry.category}`)
              .setDescription(`Ticket użytkownika <@${entry.userId}> został zamknięty przez <@${actor.id}>`)
              .setColor(0xf1c40f)
              .addFields(
                { name: 'Kanał', value: entry.channelId ? `<#${entry.channelId}>` : '—', inline: true },
                { name: 'Użytkownik', value: `<@${entry.userId}>`, inline: true },
                { name: 'Ticket ID', value: `${entry.id}`, inline: true },
                { name: 'Utworzono', value: timestampFmt(entry.createdAt), inline: true },
                { name: 'Zamknięto', value: timestampFmt(entry.archivedAt), inline: true },
                { name: 'Czas otwarty', value: durationStr(entry.createdAt, entry.archivedAt), inline: true },
              )
              .setFooter({ text: 'Ticket zamknięty', iconURL: CONFIG.FOOTER_LOGO_URL })
              .setTimestamp();
            const reopenBtn = new ButtonBuilder().setCustomId(`reopen_${entry.channelId}`).setLabel('✅Otwórz ponownie').setStyle(ButtonStyle.Success);
            const row = new ActionRowBuilder().addComponents(reopenBtn);
            const sent = await chc.send({ embeds: [embed], components: [row] }).catch(()=>null);
            return sent;
          } catch(e) { console.error('closed log send error', e); return null; }
        })();
        if (closedMsg) { entry.closedLogMessageId = closedMsg.id; saveDB(db); }

        // immediate log
        const logEmbed = buildActionLog({ action: 'close', moderatorId: actor.id, targetId: entry.userId, ticket: entry, channelId: entry.channelId });
        await sendInteractionLog(interaction.guild, logEmbed, entry.channelId).catch(()=>{});

        // schedule delete after 24h (preserved across restarts via db.deleteAt)
        setTimeout(async ()=> {
          try {
            const guild = await client.guilds.fetch(entry.guildId);
            const ch = await guild.channels.fetch(channelId).catch(()=>null);
            if (ch) await ch.delete('Auto-prune after 24h').catch(()=>null);
          } catch(e) { console.error('auto delete error', e); } finally {
            // disable closed log buttons
            try {
              if (entry.closedLogMessageId) {
                const closedCh = await client.channels.fetch(CONFIG.CLOSED_LOG_CHANNEL_ID).catch(()=>null);
                if (closedCh) { const m = await closedCh.messages.fetch(entry.closedLogMessageId).catch(()=>null); if (m) await m.edit({ components: [] }).catch(()=>{}); }
              }
            } catch {}
            delete db.tickets[channelId];
            saveDB(db);
          }
        }, 24*60*60*1000);

      } catch (e) { console.error('close flow error', e); }
    }, 5000);
  }

  // ---- Admin panel & new structured actions ----
  // When admin presses "admin_panel_<channelId>" we show top-level panel with grouped buttons.
  // Then pressing "panel_useractions_<channelId>" shows the user-actions buttons (Ban/Mute/Kick/Warn/Summon/Claim/Lock/Transcript/AddNote).
  // Each of these buttons either opens a modal (to collect reason/duration) or executes directly.

  // Helper to check admin role
  function isAdmin(member) {
    return member && member.roles && member.roles.cache && member.roles.cache.has(CONFIG.ADMIN_ROLE_ID);
  }

  // Modal prefixes will be: modal_ban_<channelId>, modal_mute_<channelId>, modal_warn_<channelId>, modal_kick_<channelId>, modal_note_<channelId>
  // InteractionCreate handles those.

  // ---- Reopen flow & "Nie" handling -> send light red embed on CLOSED_LOG_CHANNEL ----
  async function handleReopenNo(interaction, channelId) {
    try {
      const ticket = db.tickets[channelId];
      const closedCh = await client.channels.fetch(CONFIG.CLOSED_LOG_CHANNEL_ID).catch(()=>null);
      const userText = ticket && ticket.userId ? `<@${ticket.userId}>` : 'użytkownika';
      if (closedCh) {
        const redEmbed = new EmbedBuilder()
          .setTitle('❌Ticket **nie** zostanie ponownie otwarty')
          .setDescription(`Ticket ${userText} nie zostanie ponownie otwarty.`)
          .setColor(0xff6b6b)
          .setFooter({ text: '© 2025r. Sprawdziany & Kartkówki x Ponowne Otwarcie Ticketa.', iconURL: CONFIG.FOOTER_LOGO_URL })
          .setTimestamp();
        await closedCh.send({ embeds: [redEmbed] }).catch(()=>null);
      }
      // log action to interactions
      const log = buildActionLog({ action: 'reopen_cancel', moderatorId: interaction.user.id, targetId: ticket ? ticket.userId : null, ticket, channelId });
      await sendInteractionLog(interaction.guild, log, channelId).catch(()=>null);
      await interaction.reply({ content: 'Anulowano ponowne otwarcie. Wysłano informację do logów zamknięć.', ephemeral: true });
    } catch (e) {
      console.error('handleReopenNo error', e);
      try { await interaction.reply({ content: 'Błąd podczas anulowania ponownego otwarcia.', ephemeral: true }); } catch {}
    }
  }

  // ---- Restore deletion timers (kept from earlier) ----
  function restoreDeletionTimers() {
    const now = Date.now();
    for (const [channelId, ticket] of Object.entries(db.tickets || {})) {
      if (ticket.deleteAt && typeof ticket.deleteAt === 'number') {
        const ms = ticket.deleteAt - now;
        if (ms <= 0) {
          client.guilds.fetch(ticket.guildId).then(g => { g.channels.fetch(channelId).then(ch => { if (ch) ch.delete('Auto-prune'); }).catch(()=>{}); }).catch(()=>{});
          delete db.tickets[channelId];
          saveDB(db);
        } else {
          setTimeout(async () => {
            try {
              const guild = await client.guilds.fetch(ticket.guildId);
              const ch = await guild.channels.fetch(channelId).catch(()=>null);
              if (ch) await ch.delete('Auto-prune: 24h after closing').catch(()=>null);
            } catch (e) { console.error('restoreDeletionTimers inner error', e); } finally { delete db.tickets[channelId]; saveDB(db); }
          }, ms);
        }
      }
    }
  }

  // ---- Event registration ----
  if (!client._ticketModuleInitialized) {
    client._ticketModuleInitialized = true;

    client.on('ready', async () => {
      console.log('[ticket] ready');
      restoreDeletionTimers();
      for (const [, guild] of client.guilds.cache) {
        await sendOrEditPanel(guild).catch(()=>null);
      }
    });

    client.on('interactionCreate', async (interaction) => {
      try {
        // SELECT MENU -> show modals
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
            const wyd = new TextInputBuilder().setCustomId('wydawnictwo').setLabel('Wydawnictwo').setStyle(TextInputStyle.Short).setPlaceholder('Nowa Era, GWO, Mac').setRequired(false);
            const metoda = new TextInputBuilder().setCustomId('metoda').setLabel('Czym będziesz płacił?').setStyle(TextInputStyle.Short).setPlaceholder('Blik, PaysfCard, inne').setRequired(false);
            modal.addComponents(new ActionRowBuilder().addComponents(produkt), new ActionRowBuilder().addComponents(wyd), new ActionRowBuilder().addComponents(metoda));
            await interaction.showModal(modal);
            return;
          }
        }

        // MODAL SUBMIT handlers
        if (interaction.isModalSubmit()) {
          // Ticket creation modals
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

          // Admin modals: ban/mute/warn/kick/note
          if (interaction.customId.startsWith('modal_ban_')) {
            await interaction.deferReply({ ephemeral: true });
            const channelId = interaction.customId.split('modal_ban_')[1];
            const reason = interaction.fields.getTextInputValue('ban_reason') || 'Brak podanego powodu';
            const ticket = db.tickets[channelId];
            if (!ticket) { await interaction.editReply({ content: 'Ticket nieznaleziony.' }); return; }
            const guild = interaction.guild;
            try {
              await guild.members.ban(ticket.userId, { reason: `Ban z panelu ticketów: ${reason}` });
              await interaction.editReply({ content: `Użytkownik <@${ticket.userId}> zbanowany.`, ephemeral: true });
              const embed = buildActionLog({ action: 'ban', moderatorId: interaction.user.id, targetId: ticket.userId, ticket, channelId: ticket.channelId, reason });
              await sendInteractionLog(guild, embed, ticket.channelId);
            } catch (e) {
              console.error('ban error', e);
              await interaction.editReply({ content: 'Błąd podczas bana (brak uprawnień lub inny błąd).', ephemeral: true });
            }
            return;
          }

          if (interaction.customId.startsWith('modal_warn_')) {
            await interaction.deferReply({ ephemeral: true });
            const channelId = interaction.customId.split('modal_warn_')[1];
            const reason = interaction.fields.getTextInputValue('warn_reason') || 'Brak podanego powodu';
            const ticket = db.tickets[channelId];
            if (!ticket) { await interaction.editReply({ content: 'Ticket nieznaleziony.' }); return; }
            try {
              const user = await client.users.fetch(ticket.userId);
              const dm = new EmbedBuilder().setTitle('⛔Otrzymałeś ostrzeżenie!').setDescription(`Powód: ${reason}`).setFooter({ text: `Warn • ${new Date().toLocaleString()}`, iconURL: CONFIG.BOT_AVATAR_URL });
              await user.send({ embeds: [dm] }).catch(()=>{});
              await interaction.editReply({ content: `Wysłano warn do <@${ticket.userId}>.`, ephemeral: true });
              const embed = buildActionLog({ action: 'warn', moderatorId: interaction.user.id, targetId: ticket.userId, ticket, channelId: ticket.channelId, reason });
              await sendInteractionLog(interaction.guild, embed, ticket.channelId);
            } catch (e) { console.error('warn error', e); await interaction.editReply({ content: 'Błąd warn.', ephemeral: true }); }
            return;
          }

          if (interaction.customId.startsWith('modal_mute_')) {
            await interaction.deferReply({ ephemeral: true });
            const channelId = interaction.customId.split('modal_mute_')[1];
            const payload = interaction.fields.getTextInputValue('mute_payload') || ''; // expected "minutes;reason" or "minutes"
            const [minutesStr, ...reasonParts] = payload.split('|').map(s => s.trim());
            const minutes = parseInt(minutesStr) || 60;
            const reason = reasonParts.join(' ') || 'Brak podanego powodu';
            const ticket = db.tickets[channelId];
            if (!ticket) { await interaction.editReply({ content: 'Ticket nieznaleziony.' }); return; }
            try {
              const guild = interaction.guild;
              const member = await guild.members.fetch(ticket.userId).catch(()=>null);
              if (!member) { await interaction.editReply({ content: 'Nie znaleziono członka.' }); return; }
              await member.timeout(minutes * 60 * 1000, `Mute from ticket panel: ${reason}`);
              await interaction.editReply({ content: `<@${ticket.userId}> został wyciszony na ${minutes} minut.`, ephemeral: true });
              const embed = buildActionLog({ action: 'mute', moderatorId: interaction.user.id, targetId: ticket.userId, ticket, channelId: ticket.channelId, reason: `czas: ${minutes} min\npowód: ${reason}` });
              await sendInteractionLog(interaction.guild, embed, ticket.channelId);
            } catch (e) {
              console.error('mute error', e);
              await interaction.editReply({ content: 'Błąd podczas mute (upewnij się, że bot ma uprawnienia).', ephemeral: true });
            }
            return;
          }

          if (interaction.customId.startsWith('modal_kick_')) {
            await interaction.deferReply({ ephemeral: true });
            const channelId = interaction.customId.split('modal_kick_')[1];
            const reason = interaction.fields.getTextInputValue('kick_reason') || 'Brak podanego powodu';
            const ticket = db.tickets[channelId];
            if (!ticket) { await interaction.editReply({ content: 'Ticket nieznaleziony.' }); return; }
            try {
              const guild = interaction.guild;
              await guild.members.kick(ticket.userId, `Kick from ticket panel: ${reason}`);
              await interaction.editReply({ content: `Użytkownik <@${ticket.userId}> został wyrzucony.`, ephemeral: true });
              const embed = buildActionLog({ action: 'kick', moderatorId: interaction.user.id, targetId: ticket.userId, ticket, channelId: ticket.channelId, reason });
              await sendInteractionLog(interaction.guild, embed, ticket.channelId);
            } catch (e) {
              console.error('kick error', e);
              await interaction.editReply({ content: 'Błąd podczas kick (upewnij się, że bot ma uprawnienia).', ephemeral: true });
            }
            return;
          }

          if (interaction.customId.startsWith('modal_note_')) {
            await interaction.deferReply({ ephemeral: true });
            const channelId = interaction.customId.split('modal_note_')[1];
            const note = interaction.fields.getTextInputValue('note_text') || '—';
            const ticket = db.tickets[channelId];
            if (!ticket) { await interaction.editReply({ content: 'Ticket nieznaleziony.' }); return; }
            // store note to ticket (simple)
            ticket.adminNotes = ticket.adminNotes || [];
            ticket.adminNotes.push({ by: interaction.user.id, at: Date.now(), note });
            saveDB(db);
            await interaction.editReply({ content: 'Dodano notatkę do ticketu.', ephemeral: true });
            const embed = buildActionLog({ action: 'note', moderatorId: interaction.user.id, targetId: ticket.userId, ticket, channelId: ticket.channelId, reason: note });
            await sendInteractionLog(interaction.guild, embed, ticket.channelId);
            return;
          }
        } // end modal handling

        // BUTTON handling
        if (interaction.isButton()) {
          const id = interaction.customId;

          // Close ticket button -> only admin per request
          if (id.startsWith('close_ticket_')) {
            const channelId = id.split('close_ticket_')[1];
            if (!interaction.member.roles.cache.has(CONFIG.ADMIN_ROLE_ID)) { await interaction.reply({ content: 'Tylko administracja może używać tego przycisku.', ephemeral: true }); return; }
            await handleCloseTicket(interaction, channelId);
            return;
          }

          // Admin panel opener (from ticket)
          if (id.startsWith('admin_panel_')) {
            const channelId = id.split('admin_panel_')[1];
            // restrict to admin role
            if (!interaction.member.roles.cache.has(CONFIG.ADMIN_ROLE_ID)) { await interaction.reply({ content: 'Tylko administracja może używać panelu administracyjnego.', ephemeral: true }); return; }
            // top-level grouped buttons
            const groupRow = new ActionRowBuilder().addComponents(
              new ButtonBuilder().setCustomId(`panel_useractions_${channelId}`).setLabel('Działania na użytkowniku').setStyle(ButtonStyle.Primary).setEmoji('👤'),
              new ButtonBuilder().setCustomId(`panel_tickettools_${channelId}`).setLabel('Narzędzia ticketa').setStyle(ButtonStyle.Secondary).setEmoji('🛠️')
            );
            const extraRow = new ActionRowBuilder().addComponents(
              new ButtonBuilder().setCustomId(`panel_note_${channelId}`).setLabel('Dodaj notatkę').setStyle(ButtonStyle.Success).setEmoji('📝'),
              new ButtonBuilder().setCustomId(`panel_transcript_${channelId}`).setLabel('Transcript (backup)').setStyle(ButtonStyle.Secondary).setEmoji('📄')
            );
            await interaction.reply({ content: `Panel administracyjny — wybierz grupę działań dla <#${channelId}>:`, components: [groupRow, extraRow], ephemeral: true });
            return;
          }

          // Panel from log: open admin actions for the ticket (ephemeral)
          if (id.startsWith('log_admin_actions_')) {
            const channelId = id.split('log_admin_actions_')[1];
            if (!interaction.member.roles.cache.has(CONFIG.ADMIN_ROLE_ID)) { await interaction.reply({ content: 'Tylko administracja.', ephemeral: true }); return; }
            const groupRow = new ActionRowBuilder().addComponents(
              new ButtonBuilder().setCustomId(`panel_useractions_${channelId}`).setLabel('Działania na użytkowniku').setStyle(ButtonStyle.Primary).setEmoji('👤'),
              new ButtonBuilder().setCustomId(`panel_tickettools_${channelId}`).setLabel('Narzędzia ticketa').setStyle(ButtonStyle.Secondary).setEmoji('🛠️')
            );
            const extraRow = new ActionRowBuilder().addComponents(
              new ButtonBuilder().setCustomId(`panel_note_${channelId}`).setLabel('Dodaj notatkę').setStyle(ButtonStyle.Success).setEmoji('📝'),
              new ButtonBuilder().setCustomId(`panel_transcript_${channelId}`).setLabel('Transcript (backup)').setStyle(ButtonStyle.Secondary).setEmoji('📄')
            );
            await interaction.reply({ content: `Panel administracyjny (z logu) — wybierz:`, components: [groupRow, extraRow], ephemeral: true });
            return;
          }

          // panel_useractions -> show user-specific buttons
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

          // panel_tickettools -> ticket-related tools
          if (id.startsWith('panel_tickettools_')) {
            const channelId = id.split('panel_tickettools_')[1];
            if (!interaction.member.roles.cache.has(CONFIG.ADMIN_ROLE_ID)) { await interaction.reply({ content: 'Tylko administracja.', ephemeral: true }); return; }
            const row = new ActionRowBuilder().addComponents(
              new ButtonBuilder().setCustomId(`admin_transcript_${channelId}`).setLabel('📄Transcript').setStyle(ButtonStyle.Secondary),
              new ButtonBuilder().setCustomId(`admin_archive_${channelId}`).setLabel('🗂️Archwizuj').setStyle(ButtonStyle.Secondary),
              new ButtonBuilder().setCustomId(`admin_export_${channelId}`).setLabel('⬇️Export (JSON)').setStyle(ButtonStyle.Primary)
            );
            await interaction.reply({ content: 'Narzędzia ticketa:', components: [row], ephemeral: true });
            return;
          }

          // individual admin action buttons
          if (id.startsWith('admin_ban_')) {
            const channelId = id.split('admin_ban_')[1];
            if (!interaction.member.roles.cache.has(CONFIG.ADMIN_ROLE_ID)) { await interaction.reply({ content: 'Tylko administracja.', ephemeral: true }); return; }
            const modal = new ModalBuilder().setCustomId(`modal_ban_${channelId}`).setTitle('Powód bana');
            const reasonInput = new TextInputBuilder().setCustomId('ban_reason').setLabel('Powód bana (opcjonalny)').setStyle(TextInputStyle.Paragraph).setRequired(false);
            modal.addComponents(new ActionRowBuilder().addComponents(reasonInput));
            await interaction.showModal(modal);
            return;
          }
          if (id.startsWith('admin_warn_')) {
            const channelId = id.split('admin_warn_')[1];
            if (!interaction.member.roles.cache.has(CONFIG.ADMIN_ROLE_ID)) { await interaction.reply({ content: 'Tylko administracja.', ephemeral: true }); return; }
            const modal = new ModalBuilder().setCustomId(`modal_warn_${channelId}`).setTitle('Powód warna');
            const reasonInput = new TextInputBuilder().setCustomId('warn_reason').setLabel('Powód (opcjonalny)').setStyle(TextInputStyle.Paragraph).setRequired(false);
            modal.addComponents(new ActionRowBuilder().addComponents(reasonInput));
            await interaction.showModal(modal);
            return;
          }
          if (id.startsWith('admin_mute_')) {
            const channelId = id.split('admin_mute_')[1];
            if (!interaction.member.roles.cache.has(CONFIG.ADMIN_ROLE_ID)) { await interaction.reply({ content: 'Tylko administracja.', ephemeral: true }); return; }
            // single text field: "<minutes>|<powod>" or "60|spam"
            const modal = new ModalBuilder().setCustomId(`modal_mute_${channelId}`).setTitle('Mute (minuty|powód)');
            const payload = new TextInputBuilder().setCustomId('mute_payload').setLabel('Format: <minuty> | <powód>').setStyle(TextInputStyle.Short).setPlaceholder('60 | spam / brak aktywności').setRequired(true);
            modal.addComponents(new ActionRowBuilder().addComponents(payload));
            await interaction.showModal(modal);
            return;
          }
          if (id.startsWith('admin_kick_')) {
            const channelId = id.split('admin_kick_')[1];
            if (!interaction.member.roles.cache.has(CONFIG.ADMIN_ROLE_ID)) { await interaction.reply({ content: 'Tylko administracja.', ephemeral: true }); return; }
            const modal = new ModalBuilder().setCustomId(`modal_kick_${channelId}`).setTitle('Powód kicka');
            const reasonInput = new TextInputBuilder().setCustomId('kick_reason').setLabel('Powód (opcjonalny)').setStyle(TextInputStyle.Paragraph).setRequired(false);
            modal.addComponents(new ActionRowBuilder().addComponents(reasonInput));
            await interaction.showModal(modal);
            return;
          }
          if (id.startsWith('admin_summon_')) {
            const channelId = id.split('admin_summon_')[1];
            if (!interaction.member.roles.cache.has(CONFIG.ADMIN_ROLE_ID)) { await interaction.reply({ content: 'Tylko administracja.', ephemeral: true }); return; }
            const ticket = db.tickets[channelId];
            if (!ticket) { await interaction.reply({ content: 'Ticket nieznaleziony.', ephemeral: true }); return; }
            try {
              const user = await client.users.fetch(ticket.userId);
              const dm = new EmbedBuilder().setTitle('🔰Wezwanie do ticketa!').setDescription(`Moderator <@${interaction.user.id}> wzywa Cię do ticketu: <#${ticket.channelId}>`).setFooter({ text: 'Wezwanie', iconURL: CONFIG.BOT_AVATAR_URL }).setTimestamp();
              await user.send({ embeds: [dm] }).catch(()=>{});
              await interaction.reply({ content: `Wysłano wezwanie do <@${ticket.userId}>.`, ephemeral: true });
              const log = buildActionLog({ action: 'summon', moderatorId: interaction.user.id, targetId: ticket.userId, ticket, channelId: ticket.channelId });
              await sendInteractionLog(interaction.guild, log, ticket.channelId);
            } catch (e) { console.error('summon error', e); await interaction.reply({ content: 'Błąd wysłania DM.', ephemeral: true }); }
            return;
          }
          if (id.startsWith('admin_claim_')) {
            const channelId = id.split('admin_claim_')[1];
            if (!interaction.member.roles.cache.has(CONFIG.ADMIN_ROLE_ID)) { await interaction.reply({ content: 'Tylko administracja.', ephemeral: true }); return; }
            const ticket = db.tickets[channelId];
            if (!ticket) { await interaction.reply({ content: 'Ticket nieznaleziony.', ephemeral: true }); return; }
            ticket.claimedBy = interaction.user.id; saveDB(db);
            await interaction.reply({ content: `Ticket #${ticket.id} przejęty przez <@${interaction.user.id}>.`, ephemeral: true });
            const log = buildActionLog({ action: 'claim', moderatorId: interaction.user.id, targetId: ticket.userId, ticket, channelId: ticket.channelId });
            await sendInteractionLog(interaction.guild, log, ticket.channelId);
            return;
          }
          if (id.startsWith('admin_lock_')) {
            const channelId = id.split('admin_lock_')[1];
            if (!interaction.member.roles.cache.has(CONFIG.ADMIN_ROLE_ID)) { await interaction.reply({ content: 'Tylko administracja.', ephemeral: true }); return; }
            const ticket = db.tickets[channelId];
            if (!ticket) { await interaction.reply({ content: 'Ticket nieznaleziony.', ephemeral: true }); return; }
            try {
              const ch = await interaction.guild.channels.fetch(channelId).catch(()=>null);
              if (ch) await ch.permissionOverwrites.edit(ticket.userId, { SendMessages: false }).catch(()=>null);
              await interaction.reply({ content: `Ticket #${ticket.id} zablokowany.`, ephemeral: true });
              const log = buildActionLog({ action: 'lock', moderatorId: interaction.user.id, targetId: ticket.userId, ticket, channelId: ticket.channelId });
              await sendInteractionLog(interaction.guild, log, ticket.channelId);
            } catch (e) { console.error('lock error', e); await interaction.reply({ content: 'Błąd lock.', ephemeral: true }); }
            return;
          }

          // Add note
          if (id.startsWith('panel_note_') || id.startsWith('admin_note_')) {
            const channelId = id.split('_').pop();
            if (!interaction.member.roles.cache.has(CONFIG.ADMIN_ROLE_ID)) { await interaction.reply({ content: 'Tylko administracja.', ephemeral: true }); return; }
            const modal = new ModalBuilder().setCustomId(`modal_note_${channelId}`).setTitle('Dodaj notatkę');
            const noteInput = new TextInputBuilder().setCustomId('note_text').setLabel('Notatka dla ticketu').setStyle(TextInputStyle.Paragraph).setRequired(true);
            modal.addComponents(new ActionRowBuilder().addComponents(noteInput));
            await interaction.showModal(modal);
            return;
          }

          // Transcript / export placeholders
          if (id.startsWith('panel_transcript_') || id.startsWith('admin_transcript_') || id.startsWith('admin_export_')) {
            const channelId = id.split('_').pop();
            if (!interaction.member.roles.cache.has(CONFIG.ADMIN_ROLE_ID)) { await interaction.reply({ content: 'Tylko administracja.', ephemeral: true }); return; }
            // Basic placeholder: generate a small JSON snapshot (not full message history)
            const ticket = db.tickets[channelId];
            if (!ticket) { await interaction.reply({ content: 'Ticket nieznaleziony.', ephemeral: true }); return; }
            // For safety and brevity, just return ticket object as JSON file in reply (could be extended to full transcript)
            const content = JSON.stringify(ticket, null, 2);
            await interaction.reply({ content: 'Eksport ticketu (JSON):', files: [{ attachment: Buffer.from(content, 'utf8'), name: `ticket-${ticket.id}.json` }], ephemeral: true }).catch(()=> {
              interaction.editReply({ content: 'Nie udało się wygenerować eksportu.', ephemeral: true }).catch(()=>{});
            });
            const log = buildActionLog({ action: 'export', moderatorId: interaction.user.id, targetId: ticket.userId, ticket, channelId: ticket.channelId, reason: 'Export JSON' });
            await sendInteractionLog(interaction.guild, log, ticket.channelId);
            return;
          }

          // Reopen flow: yes/no handled by earlier code style
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
            // reuse reopenTicket flow from earlier modules
            // (simple implementation: call reopenTicket)
            await interaction.deferReply({ ephemeral: true });
            const entry = db.tickets[channelId];
            if (!entry) { await interaction.editReply({ content: 'Ticket nieznaleziony.' }); return; }
            // Move channel back to open category & restore perms
            const guild = interaction.guild;
            let ch = await guild.channels.fetch(channelId).catch(()=>null);
            if (ch) {
              if (CONFIG.TICKET_CATEGORY_OPEN_ID) await ch.setParent(CONFIG.TICKET_CATEGORY_OPEN_ID).catch(()=>null);
              await ch.permissionOverwrites.edit(entry.userId, { ViewChannel: true, SendMessages: true }).catch(()=>null);
            } else {
              // recreate
              const userObj = await client.users.fetch(entry.userId).catch(()=>null);
              const name = entry.category === 'ZAKUPY' ? `🛒| ${userObj ? userObj.username : 'ticket'}` : `❓|${userObj ? userObj.username : 'ticket'}`;
              ch = await guild.channels.create({ name, type: ChannelType.GuildText, permissionOverwrites: [
                { id: guild.roles.everyone.id, deny: [PermissionsBitField.Flags.ViewChannel] },
                { id: entry.userId, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.AttachFiles, PermissionsBitField.Flags.ReadMessageHistory] },
                { id: CONFIG.ADMIN_ROLE_ID, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ManageMessages] },
              ], parent: CONFIG.TICKET_CATEGORY_OPEN_ID || undefined }).catch(()=>null);
              if (ch) entry.channelId = ch.id;
            }
            // cleanup archived flags
            delete entry.archivedAt; delete entry.deleteAt;
            // create open-list entry
            try {
              const openCh = await client.channels.fetch(CONFIG.OPEN_LIST_CHANNEL_ID).catch(()=>null);
              if (openCh) {
                const openEmbed = new EmbedBuilder().setTitle(`Przywrócono Ticket #${entry.id}`).setDescription(`Kanał: <#${entry.channelId}>\nKategoria: **${entry.category}**\nUżytkownik: <@${entry.userId}>`).setColor(0x2b8af7).addFields({ name: 'Przywrócono', value: `<t:${Math.floor(Date.now()/1000)}:f>`, inline: true }, { name: 'ID', value: `${entry.id}`, inline: true }).setFooter({ text: 'Lista otwartych ticketów', iconURL: CONFIG.FOOTER_LOGO_URL }).setTimestamp();
                const m = await openCh.send({ embeds: [openEmbed] }).catch(()=>null);
                if (m) entry.openListMessageId = m.id;
              }
            } catch (e) { console.error('open list error (reopen)', e); }
            saveDB(db);
            const log = buildActionLog({ action: 'reopen', moderatorId: interaction.user.id, targetId: entry.userId, ticket: entry, channelId: entry.channelId });
            await sendInteractionLog(interaction.guild, log, entry.channelId);
            await interaction.editReply({ content: `Ticket #${entry.id} został otworzony ponownie: <#${entry.channelId}>`, ephemeral: true });
            return;
          }
          if (id.startsWith('reopen_no_')) {
            const channelId = id.split('reopen_no_')[1];
            await handleReopenNo(interaction, channelId);
            return;
          }
        } // end isButton

      } catch (err) {
        console.error('interactionCreate error:', err);
        try { if (!interaction.replied && !interaction.deferred) await interaction.reply({ content: 'Wystąpił błąd.', ephemeral: true }); } catch {}
      }
    });
  } // end if not initialized

  // expose API
  return {
    sendOrEditPanel,
    getDB: () => db,
    config: CONFIG,
  };
};