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
    contest: '1452715878205624391'
};

module.exports = (client) => {
    client.on(Events.GuildMemberAdd, async (member) => {
        try {
            const channel = member.guild.channels.cache.get(WELCOME_CHANNEL_ID);
            if (!channel) return;

            const today = new Date();
            const formattedDate = `${today.getDate()}.${today.getMonth() + 1}.${today.getFullYear()}`;
            const memberCount = member.guild.memberCount;

            // Pobieramy emoji z serwera
            const guildEmojis = member.guild.emojis.cache;
            const emojiWelcome = guildEmojis.get(EMOJI_IDS.welcome)?.toString() || '👋';
            const emojiRules = guildEmojis.get(EMOJI_IDS.rules)?.toString() || '📜';
            const emojiContest = guildEmojis.get(EMOJI_IDS.contest)?.toString() || '🏆';

            const embed = new EmbedBuilder()
                .setColor('#00FF7F')
                .setAuthor({
                    name: member.user.tag,
                    iconURL: member.user.displayAvatarURL()
                })
                .setDescription(
                    `${emojiWelcome} Witaj <@${member.id}> na serwerze Sprawdziany & Kartkówki!\n\n` +
                    `${emojiRules} Regulamin: <#${RULES_CHANNEL_ID}>\n` +
                    `${emojiContest} Konkursy: <#${CONTEST_CHANNEL_ID}>`
                )
                .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
                .setFooter({
                    text: `© 2025r. Sprawdziany & Kartkówki × Powitalnia • ${formattedDate}`
                });

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('member_count_info')
                    .setLabel(`👤 Jesteś naszym ${memberCount} użytkownikiem`)
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(true)
            );

            await channel.send({
                content: `<@${member.id}>`,
                embeds: [embed],
                components: [row]
            });

        } catch (err) {
            console.error('Błąd w welcome.js:', err);
        }
    });
};
