import * as Discord from "discord.js";
import { Inject } from "typescript-ioc";

import { BaseService } from "./base/BaseService";
import { ApplicationCommandManager } from "./services/ApplicationCommandManager";
import { CardOfTheDayService } from "./services/CardOfTheDayService";
import { CardService } from "./services/CardService";
import { CommandParser } from "./services/CommandParser";
import { EmojiService } from "./services/EmojiService";
import { EnvService } from "./services/EnvService";
import { GuildConfigurationService } from "./services/GuildConfigurationService";
import { LoggerService } from "./services/LoggerService";
import { PresenceService } from "./services/PresenceService";
import { RulesService } from "./services/RulesService";
import { nameOfConstructor } from "./utils";

/**
 * Le Bot Discord en tant que tel !
 */
export class Bot {
  private static LOG_LABEL = "Bot";

  private client!: Discord.Client;
  private commandPrefix!: string;

  @Inject private cardOfTheDayService!: CardOfTheDayService;
  @Inject private cardService!: CardService;
  @Inject private envService!: EnvService;
  @Inject private emojiService!: EmojiService;
  @Inject private guildConfigurationService!: GuildConfigurationService;
  @Inject private logger!: LoggerService;
  @Inject private presenceService!: PresenceService;
  @Inject private rulesService!: RulesService;
  @Inject private commandParser!: CommandParser;
  @Inject private applicationCommandManager!: ApplicationCommandManager;

  /** Les services qui ont besoin d'être initialisés, dans l'ordre. */
  private needInitServices: BaseService[] = [];

  /** Les services qui ont besoin d'être arrêtés, dans l'ordre. */
  private needShutdownServices: BaseService[] = [];

  /**
   * Démarre le bot en initialisant la connexion à Discord, en initialisant
   * tous les services et en installant les gestionnaires d'evénements.
   *
   * @returns Une promesse résolue une fois le bot démarré
   */
  public async init(): Promise<void> {
    const DISCORD_TOKEN = this.envService.discordToken;
    if (!DISCORD_TOKEN) {
      throw new Error("No Discord token specified!");
    }

    this.commandPrefix = this.envService.commandPrefix;

    this.logger.info(
      Bot.LOG_LABEL,
      `Démarrage en mode ${this.envService.mode}`
    );

    this.needInitServices = [
      this.logger,
      this.guildConfigurationService,
      this.presenceService,
      this.emojiService,
      this.cardService,
      this.cardOfTheDayService,
      this.rulesService,
      this.commandParser,
      this.applicationCommandManager,
    ];

    this.needShutdownServices = [
      this.cardOfTheDayService,
      this.presenceService,
    ];

    this.client = new Discord.Client({
      intents: [
        Discord.GatewayIntentBits.Guilds,
        Discord.GatewayIntentBits.GuildMessages,
        Discord.GatewayIntentBits.GuildMessageReactions,
      ],
    });
    this.client.on("ready", () => this.handleReady());
    this.client.on("interactionCreate", (interaction) =>
      this.handleInteraction(interaction)
    );
    this.client.on("messageCreate", (msg) => this.handleMessage(msg));
    this.client.on<"messageReactionAdd">(
      "messageReactionAdd",
      (reaction, user) => this.handleAddReaction(reaction, user)
    );
    this.client.on<"messageReactionRemove">(
      "messageReactionRemove",
      (reaction, user) => this.handleRemoveReaction(reaction, user)
    );

    this.logger.info(Bot.LOG_LABEL, "Connexion à Discord ...");
    await this.client.login(DISCORD_TOKEN);
    return;
  }

  /**
   * Exécuté une fois la connexion à Discord établie.
   */
  private handleReady(): void {
    this.logger.info(Bot.LOG_LABEL, "Connecté.");

    this.needInitServices.map(async (service) => {
      try {
        await service.init(this.client);
        this.logger.info(
          Bot.LOG_LABEL,
          `Service ${nameOfConstructor(service)} initialisé`
        );
      } catch (error) {
        this.logger.error(
          Bot.LOG_LABEL,
          `Problème à l'initialisation du service
          ${nameOfConstructor(service)}`,
          { error }
        );
      }
    });
  }

  /**
   * Executé dès qu'un utilisateur démarre une interaction.
   *
   * @param interaction L'interaction amorcée
   */
  private handleInteraction(interaction: Discord.Interaction): void {
    if (interaction.isCommand()) {
      this.applicationCommandManager
        .handleCommandInteraction(interaction)
        .then((applicationCommandResult) => {
          this.logger.info(
            Bot.LOG_LABEL,
            `Commande d'application traitée`,
            applicationCommandResult
          );
        })
        .catch((err) =>
          this.logger.error(
            Bot.LOG_LABEL,
            `Erreur au traitement d'une commande d'application`,
            { error: err }
          )
        );
    }
  }

  /**
   * Exécuté dès qu'un message est envoyé.
   *
   * @param msg Le message envoyé
   */
  private handleMessage(msg: Discord.Message): void {
    if (
      msg.author.bot ||
      (this.client && this.client.user && msg.author.id === this.client.user.id)
    ) {
      return;
    }

    const content = msg.content;

    if (content.startsWith(this.commandPrefix)) {
      this.commandParser
        .handleCommand(msg)
        .then((result) =>
          this.logger.info(Bot.LOG_LABEL, "Commande classique traitée", {
            result,
          })
        )
        .catch((err) =>
          this.logger.error(
            Bot.LOG_LABEL,
            "Erreur au traitement d'une commande classique",
            {
              error: err,
            }
          )
        );
    } else {
      this.commandParser.handleMessage(msg);
    }
  }

  /**
   * Executé dès qu'un utilisateur réagi à un message.
   *
   * @param reaction La réaction ajoutée
   * @param user L'utilisateur ayant ajouté la réaction
   */
  private handleAddReaction(
    reaction: Discord.MessageReaction | Discord.PartialMessageReaction,
    user: Discord.User | Discord.PartialUser
  ): void {
    if (user.bot) {
      return;
    }

    this.commandParser.handleEmojiAdd(
      reaction as Discord.MessageReaction,
      user
    );
  }

  /**
   * Exécuté dès qu'un utilisateur supprimer une réaction d'un message.
   *
   * @param reaction La réaction supprimée
   * @param user L'utilisateur ayant supprimé la réaction
   */
  private handleRemoveReaction(
    reaction: Discord.MessageReaction | Discord.PartialMessageReaction,
    user: Discord.User | Discord.PartialUser
  ): void {
    if (user.bot) {
      return;
    }

    this.commandParser.handleEmojiRemove(
      reaction as Discord.MessageReaction,
      user
    );
  }

  /**
   * Arrête proprement le bot en arrrêtant tous les services et en fermant la
   * connexion à Discord.
   *
   * @returns Une promesse résolue une fois le bot arrêté
   */
  public async shutdown(): Promise<void> {
    if (!this.client) {
      return Promise.resolve();
    }
    this.logger.info(Bot.LOG_LABEL, "Déconnexion...");
    const serviceShutdowns = this.needShutdownServices.map(async (service) => {
      try {
        await service.shutdown();
        this.logger.info(
          Bot.LOG_LABEL,
          `Service ${nameOfConstructor(service)} arrêté`
        );
      } catch (error) {
        this.logger.error(
          Bot.LOG_LABEL,
          `Erreur à l'arrêt du service ${nameOfConstructor(service)}`,
          {
            error,
          }
        );
      }
    });
    await Promise.all(serviceShutdowns);
    this.client.destroy();
    this.logger.info(Bot.LOG_LABEL, "Déconnecté.");
  }
}
