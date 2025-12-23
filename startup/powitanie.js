const {
    EmbedBuilder,
    Events,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle
} = require('discord.js');

// ID kanałów
const WELCOME_CHANNEL_ID = '1452583080333410455'; // powitanie
const RULES_CHANNEL_ID = '1452645730102677555';
const CONTEST_CHANNEL_ID = '1321027576277499944';
const INVITE_CHANNEL_ID = '1452973749543374911'; // kanał z przyciskiem generowania linku
const LOG_CHANNEL_ID = '1313177666878443540'; // kanał logów
const GUIDE_CHANNEL_ID = '1452939178571595886'; // kanał z regulaminem/guide

// ID emoji
const EMOJI_IDS = {
    welcome: '1452715257586913373',
    rules: '1452715580456042647',
    contest: '1452715878205624391',
    inviter: '1452951976785481741'
};

// Cache linków zaproszeń: inviteCode -> inviterId
const inviteCache = new Map();

// Statystyki użytkowników: userId -> { totalGenerated, joined }
const userInvites = new Map();

module.exports = (client) => {

    /*** 1️⃣ Powitanie nowych użytkowników ***/
    client.on(Events.GuildMemberAdd, async (member) => {
        try {
            const channel = member.guild.channels.cache.get(WELCOME_CHANNEL_ID);
            if (!channel) return;

            const today = new Date();
            const formattedDate = `${today.getDate()}.${today.getMonth() + 1}.${today.getFullYear()}`;
            const memberCount = member.guild.memberCount;

            const guildEmojis = member.guild.emojis.cache;
            const emojiWelcome = guildEmojis.get(EMOJI_IDS.welcome)?.toString() || '👋';
            const emojiRules = guildEmojis.get(EMOJI_IDS.rules)?.toString() || '📜';
            const emojiContest = guildEmojis.get(EMOJI_IDS.contest)?.toString() || '🏆';

            const embed = new EmbedBuilder()
                .setColor('Blue')
                .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
                .setDescription(
                    `\`\`\`👋 Sprawdziany & Kartkówki × WITAMY NA SERWERZE!\`\`\`\n` +
                    `> ${emojiWelcome} **Witaj** <@${member.id}> na serwerze **Sprawdziany & Kartkówki!**\n` +
                    `> ${emojiRules} Zapoznaj się z naszym **regulaminem**: <#${RULES_CHANNEL_ID}>\n` +
                    `> ${emojiContest} Musisz koniecznie sprawdzić **Konkursy!** <#${CONTEST_CHANNEL_ID}>`
                )
                .setFooter({
                    text: `© 2025r. Sprawdziany & Kartkówki × Powitalnia • ${formattedDate}`,
                    iconURL: 'https://cdn.discordapp.com/attachments/1313035660709593160/1452946476513759302/file_00000000671c71f4ba93b970114f47d5.png'
                });

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('member_count_info')
                    .setLabel(`👤 Jesteś naszym ${memberCount} użytkownikiem`)
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(true)
            );

            await channel.send({
                content: `||<@${member.id}>||`,
                embeds: [embed],
                components: [row]
            });

        } catch (err) {
            console.error('Błąd w powitanie.js:', err);
        }
    });

    /*** 2️⃣ Embed z przyciskiem generowania linku (tylko raz) ***/
    client.on(Events.ClientReady, async () => {
        const channel = client.channels.cache.get(INVITE_CHANNEL_ID);
        if (!channel) return;

        const messages = await channel.messages.fetch({ limit: 50 });
        const alreadySent = messages.some(msg =>
            msg.embeds.length > 0 &&
            msg.embeds[0].title === '🔗 Link z zaproszeniem'
        );

        if (!alreadySent) {
            const embed = new EmbedBuilder()
                .setTitle('🔗 Link z zaproszeniem')
                .setDescription(`Kliknij przycisk poniżej, aby wygenerować link zaproszenia na serwer!\n\nZachęcamy do zapoznania się z kanałem: <#${GUIDE_CHANNEL_ID}>`)
                .setColor('Blue');

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('generate_invite')
                    .setLabel('Generuj link zaproszenia')
                    .setStyle(ButtonStyle.Primary)
            );

            await channel.send({ embeds: [embed], components: [row] });
            console.log('Embed z przyciskiem wysłany na INVITE_CHANNEL_ID ✅');
        }
    });

    /*** 3️⃣ Obsługa przycisku generowania linku ***/
    client.on('interactionCreate', async (interaction) => {
        if (!interaction.isButton()) return;
        if (interaction.customId !== 'generate_invite') return;

        try {
            const member = interaction.member;

            // Tworzymy unikalny link zaproszenia
            const invite = await interaction.guild.invites.create(interaction.channel, {
                maxAge: 0,
                maxUses: 0,
                unique: true
            });

            // Zapisywanie w statystykach użytkownika
            if (!userInvites.has(member.id)) {
                userInvites.set(member.id, { totalGenerated: 0, joined: 0 });
            }
            const stats = userInvites.get(member.id);
            stats.totalGenerated += 1;
            userInvites.set(member.id, stats);

            // Cache linków: inviteCode -> userId
            inviteCache.set(invite.code, member.id);

            // Wysyłamy użytkownikowi w DM
            await member.send(`Twój link zaproszenia: ${invite.url}`);

            // Potwierdzenie dla użytkownika
            await interaction.reply({ content: 'Link został wygenerowany i wysłany w DM ✅', ephemeral: true });

            // Logi w kanale
            const logChannel = interaction.guild.channels.cache.get(LOG_CHANNEL_ID);
            if (!logChannel) return;

            const logEmbed = new EmbedBuilder()
                .setTitle('📝 Nowy link zaproszenia wygenerowany')
                .addFields(
                    { name: 'Użytkownik', value: `<@${member.id}>`, inline: true },
                    { name: 'Link', value: invite.url, inline: true },
                    { name: 'Kanał', value: `<#${interaction.channel.id}>`, inline: true },
                    { name: 'Godzina', value: `<t:${Math.floor(Date.now() / 1000)}:f>`, inline: true },
                    { name: 'Statystyki', value: `🔹 Wygenerowane: ${stats.totalGenerated}\n🔹 Dołączyło: ${stats.joined}`, inline: true }
                )
                .setColor('Green');

            await logChannel.send({ embeds: [logEmbed] });

        } catch (err) {
            console.error('Błąd przy generowaniu linku:', err);
            await interaction.reply({ content: 'Wystąpił błąd ❌', ephemeral: true });
        }
    });

    /*** 4️⃣ Zliczanie kto dołączył przez link ***/
    client.on(Events.GuildMemberAdd, async (member) => {
        try {
            const invites = await member.guild.invites.fetch();
            const usedInvite = invites.find(inv => inviteCache.has(inv.code) && inv.uses > 0);

            if (usedInvite) {
                const inviterId = inviteCache.get(usedInvite.code);
                if (userInvites.has(inviterId)) {
                    const stats = userInvites.get(inviterId);
                    stats.joined += 1;
                    userInvites.set(inviterId, stats);
                }
            }
        } catch (err) {
            console.error('Błąd przy aktualizacji statystyk joinów:', err);
        }
    });

};
