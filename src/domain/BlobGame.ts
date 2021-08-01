export class BlobGame {
  private static PER_INVESTIGATOR_TOTAL_HEALTH = 15;
  private static PER_INVESTIGATOR_ACT1_CLUE_THRESHOLD = 15;
  public static POSSIBLE_STORIES = [
    "RESCUE_THE_CHEMIST",
    "RECOVER_THE_SAMPLE",
    "DRIVE_OFF_THE_MIGO",
    "DEFUSE_THE_EXPLOSIVES",
  ];

  private id: number;
  private dateCreated: Date;
  private numberOfPlayers: number;

  private numberOfDamageDealtToBlob: number;
  private numberOfCluesOnAct1: number;
  private numberOfCounterMeasures: number;
  private story?: string;

  constructor(id: number, dateCreated: Date, numberOfPlayers: number) {
    this.id = id;
    this.dateCreated = dateCreated;
    this.numberOfPlayers = numberOfPlayers;

    this.numberOfDamageDealtToBlob = 0;
    this.numberOfCluesOnAct1 = 0;
    this.numberOfCounterMeasures = Math.ceil(this.numberOfPlayers / 2);
  }

  public getId(): number {
    return this.id;
  }

  public getDateCreated(): Date {
    return this.dateCreated;
  }

  public getNumberOfPlayers(): number {
    return this.numberOfPlayers;
  }

  public getBlobTotalHealth(): number {
    return this.numberOfPlayers * BlobGame.PER_INVESTIGATOR_TOTAL_HEALTH;
  }

  public getNumberOfDamageDealtToBlob(): number {
    return this.numberOfDamageDealtToBlob;
  }

  public getBlobRemainingHealth(): number {
    return this.getBlobTotalHealth() - this.numberOfDamageDealtToBlob;
  }

  public dealDamageToBlob(amount: number): this {
    this.numberOfDamageDealtToBlob += amount;
    return this;
  }

  public getAct1ClueThreshold(): number {
    return this.numberOfPlayers * BlobGame.PER_INVESTIGATOR_ACT1_CLUE_THRESHOLD;
  }

  public getNumberOfCluesOnAct1(): number {
    return this.numberOfCluesOnAct1;
  }

  public placeCluesOnAct1(numberOfClues: number): this {
    this.numberOfCluesOnAct1 += numberOfClues;
    return this;
  }

  public getNumberOfCounterMeasures(): number {
    return this.numberOfCounterMeasures;
  }

  public gainCounterMeasures(numberOfCounterMeasures: number): this {
    this.numberOfCounterMeasures += numberOfCounterMeasures;
    return this;
  }

  public spendCounterMeasures(numberOfCounterMeasures: number): this {
    this.numberOfCounterMeasures -= numberOfCounterMeasures;
    return this;
  }

  public getStory(): string | undefined {
    return this.story;
  }

  public chooseStory(story: string): this {
    if (!BlobGame.POSSIBLE_STORIES.includes(story)) {
      throw new Error(`"${story}" n'est pas une valeur possible de story.`);
    }
    this.story = story;
    return this;
  }
}