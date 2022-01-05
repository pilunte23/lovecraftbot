import * as Discord from "discord.js";
import { OnlyInstantiableByContainer, Singleton, Inject } from "typescript-ioc";

import { BaseService } from "../base/BaseService";

import { CardService, SearchType } from "./CardService";
import { EnvService } from "./EnvService";
import { LoggerService } from "./LoggerService";
import { RandomService } from "./RandomService";
import { ResourcesService } from "./ResourcesService";

@Singleton
@OnlyInstantiableByContainer
/**
 * Service permettant d'envoyer chaque jour une carte aléatoire dans un canal
 * prévu à cette effet.
 */
export class CardOfTheDayService extends BaseService {
  /** Etiquette utilisée pour les logs de ce service */
  private static LOG_LABEL = "CardOfTheDayService";

  /** Liste des codes des cartes déjà envoyée */
  private cardCodesSent: string[] = [];

  @Inject private cardService!: CardService;
  @Inject private envService!: EnvService;
  @Inject private logger!: LoggerService;
  @Inject private randomService!: RandomService;
  @Inject private resourcesService!: ResourcesService;

  public async init(client: Discord.Client): Promise<void> {
    await super.init(client);

    if (!this.envService.cardOfTheDayChannelId) {
      this.logger.info(
        CardOfTheDayService.LOG_LABEL,
        `Pas d'ID de channel pour la carte du jour.`
      );
      return;
    }

    await this.loadCardCodesSent();
    this.start();
  }

  /**
   * Démarre la routine qui vérifie l'heure courante et envoie la carte à
   * l'heure indiquée.
   */
  public start(): void {
    if (!this.client) {
      return;
    }
    const cardOfTheDayHour = this.envService.cardOfTheDayHour;

    setInterval(() => {
      const now = new Date();
      if (now.getHours() == cardOfTheDayHour && now.getMinutes() == 0) {
        this.sendCardOfTheDay().catch((error) =>
          this.logger.error(
            CardOfTheDayService.LOG_LABEL,
            "Erreur à l'envoi de la carte du jour",
            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
            { error }
          )
        );
      }
    }, 1000 * 60);

    this.logger.info(
      CardOfTheDayService.LOG_LABEL,
      `La carte du jour sera envoyée chaque jour à ${cardOfTheDayHour}H.`
    );
  }

  /**
   * Renvoie la liste des codes des cartes déjà tirées.
   *
   * @returns La liste des codes des cartes déjà tirées
   */
  public getCardCodesSent(): string[] {
    return this.cardCodesSent;
  }

  /**
   * Ajoute les codes spécifiés à la liste des codes des cartes déjà tirées
   *
   * @param codes Des codes de cartes à ajouter à la liste
   */
  public async addCardSent(codes: string[]): Promise<void> {
    for (const code of codes) {
      this.cardCodesSent.push(code);
    }
    await this.saveCardCodesSent();
  }

  /**
   * Envoie une carte aléatoire dans le canal précisé dans la configuration
   * du bot.
   *
   * @returns Une promesse résolue une fois la carte envoyée
   */
  public async sendCardOfTheDay(): Promise<void> {
    if (!this.client) {
      return;
    }

    if (this.envService.cardOfTheDayChannelId) {
      const channel = await this.client.channels.fetch(
        this.envService.cardOfTheDayChannelId
      );
      if (channel) {
        const allCodes = this.cardService.getAllPlayerCardCodes();
        const remainingCodes = allCodes.filter(
          (code) => !this.cardCodesSent.includes(code)
        );
        const randomCode =
          remainingCodes[
            this.randomService.getRandomInt(0, remainingCodes.length)
          ];
        const randomCard = this.cardService.getCards({
          searchString: randomCode,
          searchType: SearchType.BY_CODE,
        });
        if (randomCard.length > 0) {
          const embed = await this.cardService.createEmbed(randomCard[0], {
            back: false,
            extended: true,
          });
          const msg = await (channel as Discord.TextChannel).send({
            embeds: [embed],
          });
          await msg.pin();
          this.cardCodesSent.push(randomCode);
          await this.saveCardCodesSent();

          this.logger.info(
            CardOfTheDayService.LOG_LABEL,
            `Carte du jour envoyée.`
          );
        } else {
          this.logger.error(
            CardOfTheDayService.LOG_LABEL,
            `Problème lors de la récupération de la carte du jour (code: ${randomCode}).`
          );
        }
      } else {
        this.logger.error(
          CardOfTheDayService.LOG_LABEL,
          `Le channel d'ID ${this.envService.cardOfTheDayChannelId} n'a pas été trouvé.`
        );
      }
    }
  }

  /**
   * Charge les codes des cartes déjà tirées depuis le fichier.
   *
   * @returns Une promesse résolue une fois les codes chargées
   */
  private async loadCardCodesSent(): Promise<void> {
    const dataAvailable = await this.resourcesService.resourceExists(
      "cardOfTheDay.json"
    );
    if (dataAvailable) {
      const rawData = await this.resourcesService.readResource(
        "cardOfTheDay.json"
      );
      if (rawData) {
        try {
          this.cardCodesSent = JSON.parse(rawData) as string[];
        } catch (error) {
          this.logger.error(
            CardOfTheDayService.LOG_LABEL,
            "Erreur au chargement des codes de cartes déjà tirés",
            { error }
          );
        }
      }
    }
  }

  /**
   * Sauvegarde sur fichier les codes des cartes déjà tirées.
   *
   * @returns Une promesse résolue une fois les codes sauvegardés
   */
  private async saveCardCodesSent(): Promise<void> {
    await this.resourcesService.saveResource(
      "cardOfTheDay.json",
      JSON.stringify(this.cardCodesSent)
    );
  }
}
