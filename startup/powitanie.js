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

            const guildEmojis = member.guild.emojis.cache;
            const emojiWelcome = guildEmojis.get(EMOJI_IDS.welcome)
                ? `<:${guildEmojis.get(EMOJI_IDS.welcome).name}:${EMOJI_IDS.welcome}>`
                : '👋';
            const emojiRules = guildEmojis.get(EMOJI_IDS.rules)
                ? `<:${guildEmojis.get(EMOJI_IDS.rules).name}:${EMOJI_IDS.rules}>`
                : '📜';
            const emojiContest = guildEmojis.get(EMOJI_IDS.contest)
                ? `<:${guildEmojis.get(EMOJI_IDS.contest).name}:${EMOJI_IDS.contest}>`
                : '🏆';

            const embed = new EmbedBuilder()
                .setColor('Blue')
                .setTitle(`👋 NIZE × WITAMY`) // <-- nagłówek u góry
                .setThumbnail(member.user.displayAvatarURL({ dynamic: true })) // avatar po prawej
                .setDescription(
                    `> ${emojiWelcome} Witaj <@${member.id}> na serwerze Sprawdziany & Kartkówki!\n` +
                    `> ${emojiRules} Zapoznaj się z naszym regulaminem: <#${RULES_CHANNEL_ID}>\n` +
                    `> ${emojiContest} Psst! Sprawdź Konkursy! <#${CONTEST_CHANNEL_ID}>`
                )
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
                content: `||<@${member.id}>||`,
                embeds: [embed],
                components: [row]
            });

        } catch (err) {
            console.error('Błąd w powitanie.js:', err);
        }
    });
};
