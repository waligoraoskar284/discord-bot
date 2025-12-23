const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, Events, ChannelType } = require('discord.js');

module.exports = (client) => {

    const TICKET_CHANNEL_ID = '1312759128627871816'; // kanał gdzie wysyłamy embed informacyjny
    const ADMIN_ROLE_ID = '1321051189848047636';

    // =======================
    // Wiadomość informacyjna
    // =======================
    client.once(Events.ClientReady, async () => {
        try {
            const channel = await client.channels.fetch(TICKET_CHANNEL_ID);
            if (!channel) return console.log('Nie znaleziono kanału ticketowego!');

            const embed = new EmbedBuilder()
                .setColor('Blue')
                .setTitle('```Sprawdziany & Kartkówki | Tickety```')
                .setDescription(
`<:emoji1:1452712183589900298> Potrzebujesz pomocy lub kontakt w sprawach innych niż zakupy? Otwórz kategorię "<:emoji2:1452714487244132483> INNE"
<:emoji3:1452712355002585330> Interesuje Cię zakup? Otwórz kategorię "<:emoji4:1453054774172975124> ZAKUPY"`
                )
                .setImage('https://cdn.discordapp.com/attachments/1312840154070777889/1453012826334695455/logo_spr.png');

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('ticket_menu')
                    .setLabel('Otwórz ticket')
                    .setStyle(ButtonStyle.Primary)
            );

            await channel.send({ embeds: [embed], components: [row] });
            console.log('✅ Embed ticketowy wysłany!');
        } catch (err) {
            console.error('Błąd wysyłania embedu ticketowego:', err);
        }
    });

    // =======================
    // Obsługa przycisku
    // =======================
    client.on(Events.InteractionCreate, async interaction => {
        if (!interaction.isButton()) return;

        if (interaction.customId === 'ticket_menu') {
            // Tworzymy modal do wyboru kategorii
            const modal = new ModalBuilder()
                .setCustomId('ticket_modal')
                .setTitle('Otwórz ticket');

            const categoryInput = new TextInputBuilder()
                .setCustomId('ticket_category')
                .setLabel('Wybierz kategorię: INNE / ZAKUPY')
                .setStyle(TextInputStyle.Short)
                .setRequired(true);

            const descriptionInput1 = new TextInputBuilder()
                .setCustomId('ticket_desc1')
                .setLabel('Opisz problem / Co chcesz zakupić')
                .setStyle(TextInputStyle.Paragraph)
                .setRequired(true);

            const descriptionInput2 = new TextInputBuilder()
                .setCustomId('ticket_desc2')
                .setLabel('Wydawnictwo / szczegóły')
                .setStyle(TextInputStyle.Short)
                .setRequired(true);

            const descriptionInput3 = new TextInputBuilder()
                .setCustomId('ticket_desc3')
                .setLabel('Metoda płatności')
                .setStyle(TextInputStyle.Short)
                .setRequired(true);

            modal.addComponents(
                new ActionRowBuilder().addComponents(categoryInput),
                new ActionRowBuilder().addComponents(descriptionInput1),
                new ActionRowBuilder().addComponents(descriptionInput2),
                new ActionRowBuilder().addComponents(descriptionInput3)
            );

            await interaction.showModal(modal);
        }
    });

    // =======================
    // Obsługa modali
    // =======================
    client.on(Events.InteractionCreate, async interaction => {
        if (!interaction.isModalSubmit()) return;
        if (interaction.customId !== 'ticket_modal') return;

        const category = interaction.fields.getTextInputValue('ticket_category').toUpperCase();
        const desc1 = interaction.fields.getTextInputValue('ticket_desc1');
        const desc2 = interaction.fields.getTextInputValue('ticket_desc2');
        const desc3 = interaction.fields.getTextInputValue('ticket_desc3');

        // Tworzymy nowy kanał dla ticketa
        let channelName = '';
        if (category === 'INNE') channelName = `❓|${interaction.user.username}`;
        if (category === 'ZAKUPY') channelName = `🛒|${interaction.user.username}`;
        if (!channelName) return interaction.reply({ content: 'Niepoprawna kategoria!', ephemeral: true });

        const ticketChannel = await interaction.guild.channels.create({
            name: channelName,
            type: ChannelType.GuildText,
            permissionOverwrites: [
                { id: interaction.guild.id, deny: ['ViewChannel'] },
                { id: interaction.user.id, allow: ['ViewChannel', 'SendMessages'] },
                { id: ADMIN_ROLE_ID, allow: ['ViewChannel', 'SendMessages', 'ManageChannels'] }
            ]
        });

        // Embed w ticket channel
        const ticketEmbed = new EmbedBuilder()
            .setColor('Red')
            .setTitle('📝 Informacje o tickecie')
            .addFields(
                { name: 'Użytkownik', value: `${interaction.user.tag}`, inline: true },
                { name: 'Kategoria', value: category, inline: true },
                { name: 'Opis', value: desc1, inline: false },
                { name: 'Wydawnictwo', value: desc2, inline: true },
                { name: 'Metoda płatności', value: desc3, inline: true }
            )
            .setThumbnail('https://cdn.discordapp.com/attachments/1312840154070777889/1453012826334695455/logo_spr.png')
            .setFooter({ text: `Sprawdziany & Kartkówki • Ticket ${category}`, iconURL: interaction.guild.iconURL({ dynamic: true }) });

        // Przyciski administracyjne
        const adminButtons = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('close_ticket')
                .setLabel('Zamknij ticket')
                .setStyle(ButtonStyle.Danger),
            new ButtonBuilder()
                .setCustomId('call_user')
                .setLabel('Panel administracyjny')
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId('ban_user')
                .setLabel('Zbanuj użytkownika')
                .setStyle(ButtonStyle.Danger)
        );

        await ticketChannel.send({ content: `<@${interaction.user.id}>`, embeds: [ticketEmbed], components: [adminButtons] });
        await interaction.reply({ content: `Twój ticket został utworzony: ${ticketChannel}`, ephemeral: true });
    });

    // =======================
    // Obsługa admin buttonów
    // =======================
    client.on(Events.InteractionCreate, async interaction => {
        if (!interaction.isButton()) return;

        const ticketChannel = interaction.channel;

        if (interaction.customId === 'close_ticket') {
            await ticketChannel.delete().catch(() => {});
        }

        if (interaction.customId === 'call_user') {
            // Wysyłanie DM do użytkownika
            const userId = ticketChannel.name.split('|')[1];
            const user = await client.users.fetch(userId).catch(() => null);
            if (user) {
                user.send(`Prośba administratora: sprawdź swój ticket na serwerze.`).catch(() => {});
                await interaction.reply({ content: '✅ Wiadomość wysłana do użytkownika.', ephemeral: true });
            }
        }

        if (interaction.customId === 'ban_user') {
            const userId = ticketChannel.name.split('|')[1];
            const member = await interaction.guild.members.fetch(userId).catch(() => null);
            if (member) {
                await member.ban({ reason: 'Ticket naruszył zasady' }).catch(() => {});
                await interaction.reply({ content: '✅ Użytkownik zbanowany.', ephemeral: true });
                await ticketChannel.delete().catch(() => {});
            }
        }
    });

};
