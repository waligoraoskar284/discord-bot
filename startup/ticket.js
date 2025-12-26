/**
 * Ticket system (Discord.js v14) - przykładowy skrypt
 *
 * Wymagania:
 * - node >=18
 * - discord.js v14
 * - Zainstaluj: npm i discord.js@14 dotenv
 *
 * Uwaga:
 * - Uzupełnij ID w sekcji CONFIG (kanały, kategorie, role).
 * - Ten skrypt przechowuje licznik ticketów w pliku `tickets.json` (lokalnie).
 * - Ten przykład nie zawiera mechanizmu przetrwania restartu timerów (jeśli bot zrestartuje się, planowane usunięcia kanłów utracone).
 *
 * Jak używać:
 * - Umieść TOKEN w pliku .env: DISCORD_TOKEN=twój_token
 * - Uruchom: node ticket-bot.js
 *
 * Funkcje:
 * - Wysyła panel wyboru kategorii do kanału konfigurowanego (embed z obrazkiem logo).
 * - Pokazuje wybór kategorii (INNE / ZAKUPY).
 * - Otwiera modal w zależności od wyboru.
 * - Tworzy kanał-ticket z odpowiednimi uprawnieniami i wysyła embed z danymi.
 * - Przycisk "Zamknij ticket" zamyka ticket (5s), przenosi do archiwum i ustawia timer 24h do usunięcia.
 * - Przycisk "Panel administracyjny" (tylko role z ADMIN_ROLE_ID mogą użyć) otwiera przyciski administracyjne:
 *   - Ban, Wezwij (DM), Warn (DM), Claim, Lock
 * - Wszystkie działania logowane są do LOG_CHANNEL_ID.
 */

import fs from "fs";
import { config } from "dotenv";
config();

import {
  Client,
  GatewayIntentBits,
  Partials,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ModalSubmitInteraction,
  EmbedBuilder,
  PermissionsBitField,
  ChannelType,
} from "discord.js";

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildMessages],
  partials: [Partials.Channel, Partials.GuildMember, Partials.User],
});

/* ========== CONFIG - Uzupełnij ID ========== */
const CONFIG = {
  PANEL_CHANNEL_ID: "1454069542283120642", // kanał, gdzie bot wyśle panel wyboru kategorii
  TICKET_CATEGORY_OPEN_ID: null, // (opcjonalnie) ID kategorii gdzie umieszczać nowe tickety (jeśli null - będzie root)
  TICKET_CATEGORY_ARCHIVE_ID: "1453095347940491464", // kategorii dla zamkniętych ticketów
  LOG_CHANNEL_ID: "1454210870266695974", // kanał gdzie będą logi działań
  ADMIN_ROLE_ID: "1321051189848047636", // rola administracyjna do panelu
  BOT_AVATAR_URL: "https://cdn.discordapp.com/attachments/1312840154070777889/1453012826334695455/logo_spr.png?ex=694fdba5&is=694e8a25&hm=69388b1cd72462044af4223477b3ba15209a513cc0de17b726112e9f03e5afa3&",
  // emoji (możesz zmienić nazwy jeśli chcesz)
  EMOJIS: {
    info: "<:info:1452715580456042647>",
    shop: "<:shop:1453054774172975124>",
    user_info: "<:user_info:1453068281979076691>",
    ping: "<:ping:1452951976785481741>",
    tag: "<:tag:1452712046813642905>",
    id_emoji: "<:id:1452715580456042647>",
    txn_info: "<:txn:1452715310095400991>",
  },
  // Pliki
  TICKETS_DB: "./tickets.json",
};
/* ============================================ */

// helpers: prosty persistent counter (plik JSON)
function loadTicketsDB() {
  try {
    const raw = fs.readFileSync(CONFIG.TICKETS_DB, "utf8");
    return JSON.parse(raw);
  } catch {
    return { lastId: 0, tickets: {} };
  }
}
function saveTicketsDB(db) {
  fs.writeFileSync(CONFIG.TICKETS_DB, JSON.stringify(db, null, 2));
}

const ticketsDB = loadTicketsDB();

function nextTicketId() {
  ticketsDB.lastId++;
  saveTicketsDB(ticketsDB);
  return ticketsDB.lastId;
}

// Utility: log action do log channel
async function logAction(guild, text, embed = null) {
  try {
    const ch = await guild.channels.fetch(CONFIG.LOG_CHANNEL_ID);
    if (!ch || !ch.send) return;
    if (embed) return ch.send({ embeds: [embed] });
    return ch.send({ content: text });
  } catch (err) {
    console.error("Log error:", err);
  }
}

// Stwórz panel (wysyłamy na kanał PANEL_CHANNEL_ID) - embed + select menu
async function sendTicketPanel() {
  const guilds = client.guilds.cache;
  for (const [, guild] of guilds) {
    try {
      const channel = await guild.channels.fetch(CONFIG.PANEL_CHANNEL_ID).catch(() => null);
      if (!channel) continue;

      const embed = new EmbedBuilder()
        .setTitle("Wybierz kategorię")
        .setDescription(
          `${CONFIG.EMOJIS.info} Potrzebujesz pomocy lub kontaktu innego niż zakup? Wybierz kategorię **INNE**\n${CONFIG.EMOJIS.shop} Interesuje Cię zakup np. sprawdzianu/kartkówki? Wybierz kategorię **ZAKUPY**`
        )
        .setImage(CONFIG.BOT_AVATAR_URL)
        .setColor(0x2f3136)
        .setFooter({ text: "Wybierz kategorię ticketu..." });

      const select = new StringSelectMenuBuilder()
        .setCustomId("ticket_category_select")
        .setPlaceholder("Wybierz kategorię ticketa...")
        .addOptions(
          new StringSelectMenuOptionBuilder()
            .setLabel("INNE")
            .setDescription("Problemy niezwiązane z zakupami")
            .setValue("INNE"),
          new StringSelectMenuOptionBuilder()
            .setLabel("ZAKUPY")
            .setDescription("Zakup np. sprawdzianu/kartkówki")
            .setValue("ZAKUPY")
        );

      const row = new ActionRowBuilder().addComponents(select);

      // Wyślij wiadomość - jeśli istnieje już podobna od bota, można nie wysyłać; tutaj wysyłamy nową.
      await channel.send({ embeds: [embed], components: [row] });
      console.log(`Panel wysłany do ${channel.id} w guild ${guild.id}`);
    } catch (e) {
      console.error("Nie można wysłać panelu:", e);
    }
  }
}

// Tworzenie kanału ticket
async function createTicketChannel(interaction, category, formData) {
  const guild = interaction.guild;
  const author = interaction.user;
  const ticketId = nextTicketId();
  const prefix = category === "INNE" ? "❓|" : "🛒|";
  const channelName = `${prefix} ${author.username}`.slice(0, 100);

  // Permission overwrites
  const everyone = guild.roles.everyone;
  const overwrites = [
    {
      id: everyone.id,
      deny: [PermissionsBitField.Flags.ViewChannel],
    },
    {
      id: author.id,
      allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.AttachFiles, PermissionsBitField.Flags.ReadMessageHistory],
    },
  ];
  // Daj dostęp roli admin (jeśli istnieje)
  if (CONFIG.ADMIN_ROLE_ID) {
    overwrites.push({
      id: CONFIG.ADMIN_ROLE_ID,
      allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ManageMessages],
    });
  }

  const channelData = {
    name: channelName,
    type: ChannelType.GuildText,
    permissionOverwrites: overwrites,
  };
  if (CONFIG.TICKET_CATEGORY_OPEN_ID) channelData.parent = CONFIG.TICKET_CATEGORY_OPEN_ID;

  const ticketChannel = await guild.channels.create(channelData);

  // Zapis ticketu do DB
  ticketsDB.tickets[ticketChannel.id] = {
    id: ticketId,
    userId: author.id,
    category,
    form: formData,
    createdAt: new Date().toISOString(),
  };
  saveTicketsDB(ticketsDB);

  // Przyciski pod embedem
  const closeButton = new ButtonBuilder().setCustomId(`close_ticket_${ticketChannel.id}`).setLabel("Zamknij ticket").setStyle(ButtonStyle.Danger).setEmoji("❌");
  const adminPanelBtn = new ButtonBuilder().setCustomId(`admin_panel_${ticketChannel.id}`).setLabel("Panel administracyjny").setStyle(ButtonStyle.Primary).setEmoji("👑");

  const row = new ActionRowBuilder().addComponents(closeButton, adminPanelBtn);

  // Embed ticketu
  const embed = new EmbedBuilder()
    .setTitle(`Ticket #${ticketId} | ${category}`)
    .setThumbnail(author.displayAvatarURL({ forceStatic: false }))
    .setColor(category === "ZAKUPY" ? 0x5865f2 : 0x2f3136)
    .addFields(
      { name: `${CONFIG.EMOJIS.user_info} INFORMACJE O UŻYTKOWNIKU`, value: "\u200B" },
      { name: `${CONFIG.EMOJIS.ping} Ping`, value: `<@${author.id}>`, inline: true },
      { name: `${CONFIG.EMOJIS.tag} TAG`, value: `${author.tag}`, inline: true },
      { name: `${CONFIG.EMOJIS.id_emoji} ID użytkownika`, value: `${author.id}`, inline: true },
      { name: `${CONFIG.EMOJIS.txn_info} INFORMACJE O TRANSAKCJI`, value: "\u200B" }
    )
    .setFooter({ text: `Utworzony przez: ${author.tag} • ${new Date().toLocaleString()}` });

  if (category === "ZAKUPY") {
    embed.addFields(
      { name: "ID transakcji", value: `${ticketId}`, inline: true },
      { name: "Kategoria", value: `${category}`, inline: true },
      { name: "Produkt", value: `${formData.produkt || "—"}`, inline: false },
      { name: "Wydawnictwo", value: `${formData.wydawnictwo || "—"}`, inline: true },
      { name: "Metoda płatności", value: `${formData.metoda || "—"}`, inline: true }
    );
  } else {
    embed.addFields({ name: "ID transakcji", value: `${ticketId}`, inline: true }, { name: "Kategoria", value: `${category}`, inline: true }, { name: "Opis problemu", value: `${formData.opis || "—"}`, inline: false });
  }

  // Wyślij ping nad embedem (osobna wiadomość z pingiem + avatar użytkownika po prawej)
  await ticketChannel.send({ content: `🔔 <@${author.id}>`, embeds: [embed], components: [row] });

  // Log akcję
  await logAction(guild, null, new EmbedBuilder().setTitle("Ticket otwarty").setDescription(`Ticket #${ticketId} utworzony przez <@${author.id}> w kanale <#${ticketChannel.id}>`).setTimestamp());

  return ticketChannel;
}

// Handler dla zamknięcia ticketu
async function handleCloseTicket(interaction, ticketChannelId) {
  await interaction.deferReply({ ephemeral: true });
  const guild = interaction.guild;
  const member = interaction.user;
  const ticketEntry = ticketsDB.tickets[ticketChannelId];
  if (!ticketEntry) {
    await interaction.editReply({ content: "Nie znaleziono ticketu w bazie." });
    return;
  }
  const ticketChannel = await guild.channels.fetch(ticketChannelId);
  if (!ticketChannel) {
    await interaction.editReply({ content: "Nie można znaleźć kanału ticketu." });
    return;
  }

  // Ephemeral embed do użytkownika informujący o zamknięciu
  const closingEmbed = new EmbedBuilder()
    .setTitle("Zamknięcie nastąpi w przeciągu 5 sekund. Dziękujemy.")
    .setDescription(`❗Ticket został zamknięty przez <@${member.id}>. Dziękujemy.`)
    .setColor(0xff0000)
    .setFooter({ text: `❌zamknęto ticket. • ${new Date().toLocaleString()}`, iconURL: CONFIG.BOT_AVATAR_URL });

  await interaction.editReply({ embeds: [closingEmbed] });

  // Odczekaj 5 sekund i przenieś kanł do archiwum
  setTimeout(async () => {
    try {
      await ticketChannel.setParent(CONFIG.TICKET_CATEGORY_ARCHIVE_ID).catch(() => null);
      // Zablokuj pisanie dla użytkownika
      await ticketChannel.permissionOverwrites.edit(ticketEntry.userId, { SendMessages: false }).catch(() => null);

      // Log i zaplanuj usunięcie po 24h
      await logAction(guild, null, new EmbedBuilder().setTitle("Ticket zamknięty").setDescription(`Ticket #${ticketEntry.id} zamknięty przez <@${member.id}>. Kanał: <#${ticketChannel.id}>`).setTimestamp());

      // Zaplanuj usunięcie po 24h
      setTimeout(async () => {
        try {
          await ticketChannel.delete("Auto-prune: 24h po zamknięciu");
          // usuń z DB
          delete ticketsDB.tickets[ticketChannel.id];
          saveTicketsDB(ticketsDB);
          await logAction(guild, `Ticket #${ticketEntry.id} został usunięty po 24h.`).catch(() => null);
        } catch (e) {
          console.error("Usuwanie ticketu się nie powiodło:", e);
        }
      }, 24 * 60 * 60 * 1000);
    } catch (e) {
      console.error("Błąd przy przenoszeniu ticketu:", e);
    }
  }, 5000);
}

// Admin actions: ban, summon (DM), warn (DM), claim, lock
async function handleAdminAction(interaction, action, ticketChannelId) {
  await interaction.deferReply({ ephemeral: true });
  const guild = interaction.guild;
  const member = interaction.member;
  if (!member.roles.cache.has(CONFIG.ADMIN_ROLE_ID)) {
    await interaction.editReply({ content: "Nie masz uprawnień do użycia panelu administracyjnego." });
    return;
  }
  const ticketEntry = ticketsDB.tickets[ticketChannelId];
  if (!ticketEntry) {
    await interaction.editReply({ content: "Ticket nieznaleziony w bazie." });
    return;
  }
  const targetUserId = ticketEntry.userId;
  const targetMember = await guild.members.fetch(targetUserId).catch(() => null);

  if (action === "ban") {
    if (!targetMember) return interaction.editReply({ content: "Nie można znaleźć użytkownika, ban niemożliwy." });
    await guild.members.ban(targetUserId, { reason: `Ban z panelu ticketów przez ${interaction.user.tag}` }).catch((e) => console.error(e));
    await interaction.editReply({ content: `Użytkownik <@${targetUserId}> został zbanowany.` });
    await logAction(guild, null, new EmbedBuilder().setTitle("Akcja: Ban").setDescription(`<@${interaction.user.id}> zbanował <@${targetUserId}> (ticket #${ticketEntry.id})`).setTimestamp());
  } else if (action === "summon") {
    // DM user
    const dmEmbed = new EmbedBuilder().setTitle("🔰Wezwanie do ticketa!").setDescription(`Użytkownik <@${interaction.user.id}> wzywa Cię do ticketa❗\nZnajdziesz go tutaj: <#${ticketChannelId}>`).setFooter({ text: `❌Wezwanie do ticketa. • ${new Date().toLocaleString()}`, iconURL: CONFIG.BOT_AVATAR_URL });
    try {
      const user = await client.users.fetch(targetUserId);
      await user.send({ embeds: [dmEmbed] });
      await interaction.editReply({ content: `Wysłano wezwanie do <@${targetUserId}>.` });
      await logAction(guild, null, new EmbedBuilder().setTitle("Akcja: Wezwanie").setDescription(`<@${interaction.user.id}> wezwał <@${targetUserId}> do ticketu #${ticketEntry.id}`).setTimestamp());
    } catch (e) {
      await interaction.editReply({ content: `Nie udało się wysłać DM do użytkownika.` });
    }
  } else if (action === "warn") {
    const dmEmbed = new EmbedBuilder().setTitle("⛔Otrzymałeś ostrzeżenie!").setDescription(`Użytkownik <@${interaction.user.id}> ostrzega cię, że jeżeli nie skontaktujesz się na tickecie w przeciągu 24 godzin to twój ticket zostanie zamknięty przez osobę z administracji.`).setFooter({ text: `❌Wezwanie do ticketa. • ${new Date().toLocaleString()}`, iconURL: CONFIG.BOT_AVATAR_URL });
    try {
      const user = await client.users.fetch(targetUserId);
      await user.send({ embeds: [dmEmbed] });
      await interaction.editReply({ content: `Wysłano ostrzeżenie do <@${targetUserId}>.` });
      await logAction(guild, null, new EmbedBuilder().setTitle("Akcja: Warn").setDescription(`<@${interaction.user.id}> wysłał warn do <@${targetUserId}> (ticket #${ticketEntry.id})`).setTimestamp());
    } catch (e) {
      await interaction.editReply({ content: `Nie udało się wysłać DM do użytkownika.` });
    }
  } else if (action === "claim") {
    // Oznacz w DB kto claimnął
    ticketEntry.claimedBy = interaction.user.id;
    saveTicketsDB(ticketsDB);
    await interaction.editReply({ content: `Ticket #${ticketEntry.id} przejęty przez <@${interaction.user.id}>.` });
    await logAction(guild, null, new EmbedBuilder().setTitle("Akcja: Claim").setDescription(`<@${interaction.user.id}> przejął ticket #${ticketEntry.id}`).setTimestamp());
  } else if (action === "lock") {
    // Zablokuj pisanie wszystkim oprócz adminów i autora
    const ch = await guild.channels.fetch(ticketChannelId);
    if (!ch) return interaction.editReply({ content: "Kanał nie znaleziony." });
    await ch.permissionOverwrites.edit(ticketEntry.userId, { SendMessages: false }).catch(() => null);
    await interaction.editReply({ content: `Ticket #${ticketEntry.id} zablokowany.` });
    await logAction(guild, null, new EmbedBuilder().setTitle("Akcja: Lock").setDescription(`<@${interaction.user.id}> zablokował ticket #${ticketEntry.id}`).setTimestamp());
  }
}

client.on("ready", async () => {
  console.log(`Zalogowano jako ${client.user.tag}`);
  // Wyślij panel przy starcie
  await sendTicketPanel();
});

client.on("interactionCreate", async (interaction) => {
  try {
    // Select menu: wybór kategorii
    if (interaction.isStringSelectMenu() && interaction.customId === "ticket_category_select") {
      const selected = interaction.values[0];
      if (selected === "INNE") {
        // pokaż Modal dla INNE
        const modal = new ModalBuilder().setCustomId("modal_INNE").setTitle("Otwórz ticket - INNE");

        const opis = new TextInputBuilder().setCustomId("opis_problem").setLabel("Opisz problem").setStyle(TextInputStyle.Paragraph).setPlaceholder("Np. Mam problem z weryfikacją.").setRequired(true);

        modal.addComponents(new ActionRowBuilder().addComponents(opis));
        await interaction.showModal(modal);
      } else if (selected === "ZAKUPY") {
        const modal = new ModalBuilder().setCustomId("modal_ZAKUPY").setTitle("Otwórz ticket - ZAKUPY");

        const produkt = new TextInputBuilder().setCustomId("produkt").setLabel("Co chcesz zakupić?").setStyle(TextInputStyle.Short).setPlaceholder("Sprawdzian/Kartkówka lub coś innego").setRequired(true);
        const wydawnictwo = new TextInputBuilder().setCustomId("wydawnictwo").setLabel("Wydawnictwo").setStyle(TextInputStyle.Short).setPlaceholder("Nowa Era, GWO, Mac").setRequired(false);
        const metoda = new TextInputBuilder().setCustomId("metoda").setLabel("Czym będziesz płacił?").setStyle(TextInputStyle.Short).setPlaceholder("Blik, PaysfCard, inne").setRequired(false);

        modal.addComponents(new ActionRowBuilder().addComponents(produkt), new ActionRowBuilder().addComponents(wydawnictwo), new ActionRowBuilder().addComponents(metoda));
        await interaction.showModal(modal);
      }
    }

    // Modal submit handlers
    if (interaction.isModalSubmit()) {
      if (interaction.customId === "modal_INNE") {
        const opis = interaction.fields.getTextInputValue("opis_problem");
        await interaction.reply({ content: "Tworzę ticket...", ephemeral: true });
        const ch = await createTicketChannel(interaction, "INNE", { opis });
        await interaction.editReply({ content: `Ticket utworzony: <#${ch.id}>`, ephemeral: true });
      } else if (interaction.customId === "modal_ZAKUPY") {
        const produkt = interaction.fields.getTextInputValue("produkt");
        const wydawnictwo = interaction.fields.getTextInputValue("wydawnictwo") || "—";
        const metoda = interaction.fields.getTextInputValue("metoda") || "—";
        await interaction.reply({ content: "Tworzę ticket...", ephemeral: true });
        const ch = await createTicketChannel(interaction, "ZAKUPY", { produkt, wydawnictwo, metoda });
        await interaction.editReply({ content: `Ticket utworzony: <#${ch.id}>`, ephemeral: true });
      }
    }

    // Button interactions
    if (interaction.isButton()) {
      // Zamknij ticket
      if (interaction.customId.startsWith("close_ticket_")) {
        const channelId = interaction.customId.split("close_ticket_")[1];
        // Sprawdź czy osoba może zamknąć (autor kanału lub admin)
        const ticketEntry = ticketsDB.tickets[channelId];
        if (!ticketEntry) return interaction.reply({ content: "Ticket nieznaleziony.", ephemeral: true });
        const isAuthor = interaction.user.id === ticketEntry.userId;
        const isAdmin = interaction.member.roles.cache.has(CONFIG.ADMIN_ROLE_ID);
        if (!isAuthor && !isAdmin) return interaction.reply({ content: "Nie masz uprawnień do zamknięcia tego ticketu.", ephemeral: true });
        await handleCloseTicket(interaction, channelId);
      }

      // Admin panel
      if (interaction.customId.startsWith("admin_panel_")) {
        const channelId = interaction.customId.split("admin_panel_")[1];
        // pokaż kolejne przyciski (3 administracyjne + 2 dodatkowe)
        const adminActionsRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`admin_ban_${channelId}`).setLabel("❗Ban").setStyle(ButtonStyle.Danger),
          new ButtonBuilder().setCustomId(`admin_summon_${channelId}`).setLabel("🔇Wezwij do ticketa").setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId(`admin_warn_${channelId}`).setLabel("🎯Warn").setStyle(ButtonStyle.Primary)
        );
        const extraRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`admin_claim_${channelId}`).setLabel("🛠️Claim").setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId(`admin_lock_${channelId}`).setLabel("🔒Lock").setStyle(ButtonStyle.Secondary)
        );
        await interaction.reply({ content: "Panel administracyjny:", components: [adminActionsRow, extraRow], ephemeral: true });
      }

      // Admin action buttons - różne
      if (interaction.customId.startsWith("admin_ban_")) {
        const channelId = interaction.customId.split("admin_ban_")[1];
        await handleAdminAction(interaction, "ban", channelId);
      }
      if (interaction.customId.startsWith("admin_summon_")) {
        const channelId = interaction.customId.split("admin_summon_")[1];
        await handleAdminAction(interaction, "summon", channelId);
      }
      if (interaction.customId.startsWith("admin_warn_")) {
        const channelId = interaction.customId.split("admin_warn_")[1];
        await handleAdminAction(interaction, "warn", channelId);
      }
      if (interaction.customId.startsWith("admin_claim_")) {
        const channelId = interaction.customId.split("admin_claim_")[1];
        await handleAdminAction(interaction, "claim", channelId);
      }
      if (interaction.customId.startsWith("admin_lock_")) {
        const channelId = interaction.customId.split("admin_lock_")[1];
        await handleAdminAction(interaction, "lock", channelId);
      }
    }
  } catch (err) {
    console.error("Error on interactionCreate:", err);
    if (interaction.replied === false && interaction.deferred === false) {
      try {
        await interaction.reply({ content: "Wystąpił błąd.", ephemeral: true });
      } catch {}
    }
  }
});

client.login(process.env.DISCORD_TOKEN);
