const {
    EmbedBuilder,
    Events,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle
} = require('discord.js');

// ID kanałów
const WELCOME_CHANNEL_ID = '1452583080333410455';
const RULES_CHANNEL_ID = '1452645730102677555';
const CONTEST_CHANNEL_ID = '1321027576277499944';

// ID emoji z serwera
const EMOJI_IDS = {
    welcome: '1452715257586913373',
    rules: '1452715580456042647',
    contest: '1452715878205624391',
    inviter: '1452951976785481741'
};

// Cache zaproszeń dla każdej gildii
const invitesCache = new Map();

module.exports = (client) => {

    // Pobranie zaproszeń po starcie bota
    client.on('ready', async () => {
        client.guilds.cache.forEach(async guild => {
            const invites = await guild.invites.fetch();
            invitesCache.set(guild.id, invites);
        });
    });

    client.on(Events.GuildMemberAdd, async (member) => {
        try {
            const channel = member.guild.channels.cache.get(WELCOME_CHANNEL_ID);
            if (!channel) return;

            const today = new Date();
            const formattedDate = `${today.getDate()}.${today.getMonth() + 1}.${today.getFullYear()}`;
            const memberCount = member.guild.memberCount;

            // Pobranie emoji z serwera
            const guildEmojis = member.guild.emojis.cache;
            const emojiWelcome = guildEmojis.get(EMOJI_IDS.welcome)?.toString() || '👋';
            const emojiRules = guildEmojis.get(EMOJI_IDS.rules)?.toString() || '📜';
            const emojiContest = guildEmojis.get(EMOJI_IDS.contest)?.toString() || '🏆';
            const emojiInviter = guildEmojis.get(EMOJI_IDS.inviter)?.toString() || '🔗';

            // Wykrycie zaproszenia
            const cachedInvites = invitesCache.get(member.guild.id);
            const newInvites = await member.guild.invites.fetch();
            const usedInvite = newInvites.find(i => cachedInvites.get(i.code)?.uses < i.uses);
            const inviter = usedInvite ? usedInvite.inviter : null;

            // Aktualizacja cache
            invitesCache.set(member.guild.id, newInvites);

            // Tworzenie embedu
            const embed = new EmbedBuilder()
                .setColor('Blue')
                .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
                .setDescription(
                    `\`\`\`👋 Sprawdziany & Kartkówki × WITAMY NA SERWERZE!\`\`\`\n` +
                    `> ${emojiWelcome} **Witaj** <@${member.id}> na serwerze **Sprawdziany & Kartkówki!**\n` +
                    `> ${emojiRules} Zapoznaj się z naszym **regulaminem**: <#${RULES_CHANNEL_ID}>\n` +
                    `> ${emojiContest} Musisz koniecznie sprawdzić **Konkursy!** <#${CONTEST_CHANNEL_ID}>\n` +
                    `> ${emojiInviter} Zaproszony przez: ${inviter ? `<@${inviter.id}>` : 'Nieznany'}`
                )
                .setFooter({
                    text: `© 2025r. Sprawdziany & Kartkówki × Powitalnia • ${formattedDate}`,
                    iconURL: 'https://cdn.discordapp.com/attachments/1313035660709593160/1452946476513759302/file_00000000671c71f4ba93b970114f47d5.png'
                });

            // Przygotowanie nieklikalnego przycisku
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
};
