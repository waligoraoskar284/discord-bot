const { 
    EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, 
    TextInputBuilder, TextInputStyle, Events, ChannelType, PermissionFlagsBits 
} = require('discord.js');

let ticketCounter = 1; // licznik ticketów

module.exports = (client) => {

    const TICKET_CHANNEL_ID = '1312759128627871816';
    const ADMIN_ROLE_ID = '1436376487157694586';

    client.once(Events.ClientReady, async () => {
        const channel = await client.channels.fetch(TICKET_CHANNEL_ID);
        if (!channel) return console.log('Nie znaleziono kanału ticketów!');

        const embed = new EmbedBuilder()
            .setColor('Blue')
            .setTitle('```Sprawdziany & Kartkówki | Tickety```')
            .setDescription(
                '<:emoji_help:1452712183589900298> Potrzebujesz pomocy lub chcesz się skontaktować w jakiejś innej sprawie nie związaną z zakupem? Wybierz kategorię "(<:emoji_inne:1452714487244132483>) INNE"\n\n' +
                '<:emoji_shop:1452712355002585330> Jeżeli interesuje cię zakup np. Sprawdzianu lub Kartkówki otwórz kategorię "(<:emoji_zakupy:1453054774172975124>) ZAKUPY"'
            )
            .setImage('https://cdn.discordapp.com/attachments/1312840154070777889/1453012826334695455/logo_spr.png');

        const button = new ButtonBuilder()
            .setLabel('Otwórz Ticket')
            .setCustomId('open_ticket')
            .setStyle(ButtonStyle.Primary);

        const row = new ActionRowBuilder().addComponents(button);

        await channel.send({ embeds: [embed], components: [row] });
        console.log('✅ Ticket panel wysłany!');
    });

    client.on(Events.InteractionCreate, async (interaction) => {
        if (!interaction.isButton()) return;

        if (interaction.customId === 'open_ticket') {
            const modal = new ModalBuilder()
                .setCustomId('ticket_modal')
                .setTitle('Wybierz kategorię');

            const categoryInput = new TextInputBuilder()
                .setCustomId('ticket_category')
                .setLabel('Wybierz kategorię: INNE lub ZAKUPY')
                .setStyle(TextInputStyle.Short)
                .setRequired(true);

            modal.addComponents(new ActionRowBuilder().addComponents(categoryInput));
            await interaction.showModal(modal);
        }
    });

    client.on(Events.InteractionCreate, async (interaction) => {
        if (!interaction.isModalSubmit()) return;
        if (interaction.customId !== 'ticket_modal') return;

        const category = interaction.fields.getTextInputValue('ticket_category').toLowerCase();
        const guild = interaction.guild;

        // Tworzenie kanału ticket
        const ticketName = category === 'zakupy' ? `🛒|${interaction.user.username}` : `❓|${interaction.user.username}`;
        const ticketChannel = await guild.channels.create({
            name: ticketName,
            type: ChannelType.GuildText,
            parent: null,
            permissionOverwrites: [
                {
                    id: guild.roles.everyone,
                    deny: [PermissionFlagsBits.ViewChannel]
                },
                {
                    id: interaction.user.id,
                    allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages]
                },
                {
                    id: ADMIN_ROLE_ID,
                    allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages]
                }
            ]
        });

        // Formularze różne dla kategorii
        let fields = [];
        if (category === 'zakupy') {
            fields = [
                { label: 'Co chcesz zakupić?', id: 'produkt' },
                { label: 'Wydawnictwo', id: 'wydawnictwo' },
                { label: 'Metoda Płatności', id: 'platnosc' }
            ];
        } else {
            fields = [
                { label: 'Opisz problem', id: 'opis' }
            ];
        }

        const modal = new ModalBuilder()
            .setCustomId(`ticket_form_${ticketCounter}`)
            .setTitle(category === 'zakupy' ? 'Zakupy' : 'Inne');

        fields.forEach(f => {
            const input = new TextInputBuilder()
                .setCustomId(f.id)
                .setLabel(f.label)
                .setStyle(TextInputStyle.Paragraph)
                .setRequired(true);
            modal.addComponents(new ActionRowBuilder().addComponents(input));
        });

        await interaction.reply({ content: `Otworzyłem dla Ciebie ticket: ${ticketChannel}`, ephemeral: true });
        await interaction.user.send({ content: `Wypełnij formularz w tym ticket: ${ticketChannel}` }); 

        await interaction.showModal(modal);
        ticketCounter++;
    });

    client.on(Events.InteractionCreate, async (interaction) => {
        if (!interaction.isModalSubmit()) return;

        if (interaction.customId.startsWith('ticket_form_')) {
            const channel = interaction.channel;
            const category = channel.name.startsWith('🛒') ? 'zakupy' : 'inne';

            const embed = new EmbedBuilder()
                .setColor(category === 'zakupy' ? 'Red' : 'Green')
                .setTitle('Informacje o użytkowniku')
                .setDescription(
                    `> <:emoji_ping:1453068281979076691> Ping: ${interaction.user}\n` +
                    `> <:emoji_tag:1452951976785481741> TAG: ${interaction.user.tag}\n` +
                    `> <:emoji_id:1452715580456042647> ID: ${interaction.user.id}\n\n`
                );

            if (category === 'zakupy') {
                embed.addFields(
                    { name: 'Informacje o transakcji', value: 
                    `> ID Transakcji: ${channel.name}\n` +
                    `> Kategoria Ticketa: Zakupy\n` +
                    `> Produkt: ${interaction.fields.getTextInputValue('produkt')}\n` +
                    `> Wydawnictwo: ${interaction.fields.getTextInputValue('wydawnictwo')}\n` +
                    `> Metoda Płatności: ${interaction.fields.getTextInputValue('platnosc')}` }
                );
            } else {
                embed.addFields(
                    { name: 'Opis', value: interaction.fields.getTextInputValue('opis') }
                );
            }

            const row = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId('close_ticket')
                        .setLabel('Zamknij ticket')
                        .setStyle(ButtonStyle.Danger)
                );

            await channel.send({ embeds: [embed], components: [row] });
            await interaction.reply({ content: 'Ticket został utworzony i wysłany!', ephemeral: true });
        }
    });

    // Obsługa przycisku Zamknij ticket
    client.on(Events.InteractionCreate, async (interaction) => {
        if (!interaction.isButton()) return;
        if (interaction.customId !== 'close_ticket') return;
        if (!interaction.member.roles.cache.has(ADMIN_ROLE_ID)) return interaction.reply({ content: 'Nie masz uprawnień!', ephemeral: true });

        await interaction.channel.delete();
    });
};
