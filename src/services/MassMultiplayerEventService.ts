import {
  Channel,
  Client,
  Guild,
  GuildChannel,
  Message,
  MessageEmbed,
  TextChannel,
} from "discord.js";
import { Inject, OnlyInstantiableByContainer, Singleton } from "typescript-ioc";

import { BaseService } from "../base/BaseService";

import { EnvService } from "./EnvService";
import { LoggerService } from "./LoggerService";
import { ResourcesService } from "./ResourcesService";

export class MassMultiplayerEventServiceError extends Error {
  public static configurationMissing(): MassMultiplayerEventServiceError {
    return new this("MassMultiplayerEventService: configuration absente");
  }
  public static eventCategoryNotFound(
    categoryName: string
  ): MassMultiplayerEventServiceError {
    return new this(
      `MassMultiplayerEventService: impossible de trouver la catégorie ${categoryName}`
    );
  }
}

@Singleton
@OnlyInstantiableByContainer
export class MassMultiplayerEventService extends BaseService {
  private static LOG_LABEL = "MassMultiplayerEventService";

  private static STATE_FILE_NAME = "massMultiplayerEventsGroups.json";
  @Inject envService!: EnvService;
  @Inject logger!: LoggerService;
  @Inject resourcesService!: ResourcesService;

  private groupChannelsIdByGuildId: { [guildId: string]: string[] } = {};

  public async init(client: Client): Promise<void> {
    await super.init(client);

    await Promise.all(
      client.guilds.cache.map((guild) => {
        return this.loadState(guild);
      })
    );
  }

  public runningEvent(guild: Guild): boolean {
    return (
      this.groupChannelsIdByGuildId[guild.id] &&
      this.groupChannelsIdByGuildId[guild.id].length !== 0
    );
  }

  public isEventChannel(channel: Channel): boolean {
    if (!channel.isText()) return false;
    if (!this.envService.massMultiplayerEventCategoryName) return false;

    const channelParent = (channel as GuildChannel).parent;
    if (channelParent === null) return false;

    return (
      channelParent.name === this.envService.massMultiplayerEventCategoryName
    );
  }

  public isAdminChannel(channel: Channel): boolean {
    if (!channel.isText()) return false;
    if (!this.envService.massMultiplayerEventCategoryName) return false;
    if (!this.envService.massMultiplayerEventAdminChannelName) return false;

    const channelParent = (channel as GuildChannel).parent;
    if (channelParent === null) return false;

    return (
      channelParent.name === this.envService.massMultiplayerEventCategoryName &&
      (channel as TextChannel).name ===
        this.envService.massMultiplayerEventAdminChannelName
    );
  }

  public getAdminChannel(guild: Guild): TextChannel | undefined {
    if (
      !this.envService.massMultiplayerEventCategoryName &&
      !this.envService.massMultiplayerEventAdminChannelName
    )
      throw MassMultiplayerEventServiceError.configurationMissing();

    return guild.channels.cache.find(
      (channel) =>
        channel.parent !== null &&
        channel.parent.name ===
          this.envService.massMultiplayerEventCategoryName &&
        channel.type === "GUILD_TEXT" &&
        channel.name === this.envService.massMultiplayerEventAdminChannelName
    ) as TextChannel | undefined;
  }

  public getChannel(guild: Guild, groupId: string): Channel | undefined {
    return guild.channels.cache.find((channel) => channel.id === groupId);
  }

  public async createGroupChannels(
    guild: Guild,
    numberOfGroups: number
  ): Promise<void> {
    if (!this.envService.massMultiplayerEventCategoryName)
      throw MassMultiplayerEventServiceError.configurationMissing();

    const categoryId = this.getCategoryIdByName(
      guild,
      this.envService.massMultiplayerEventCategoryName
    );
    if (!categoryId)
      throw MassMultiplayerEventServiceError.eventCategoryNotFound(
        this.envService.massMultiplayerEventCategoryName
      );

    for (let groupNumber = 1; groupNumber <= numberOfGroups; groupNumber++) {
      const groupChannel = await guild.channels.create(
        `groupe-${groupNumber}`,
        {
          type: "GUILD_TEXT",
        }
      );
      await groupChannel.setParent(categoryId);

      const groupVoiceChannel = await guild.channels.create(
        `voice-groupe-${groupNumber}`,
        {
          type: "GUILD_VOICE",
        }
      );
      await groupVoiceChannel.setParent(categoryId);

      if (this.groupChannelsIdByGuildId[guild.id]) {
        this.groupChannelsIdByGuildId[guild.id].push(groupChannel.id);
        this.groupChannelsIdByGuildId[guild.id].push(groupVoiceChannel.id);
      } else {
        this.groupChannelsIdByGuildId[guild.id] = [
          groupChannel.id,
          groupVoiceChannel.id,
        ];
      }
    }
    await this.saveState(guild);
  }

  public async cleanGroupChannels(guild: Guild): Promise<void> {
    const groupsId = this.groupChannelsIdByGuildId[guild.id];
    await Promise.all(
      groupsId.map((groupId) => {
        const channel = guild.channels.cache.find(
          (channel) => channel.id === groupId
        );
        return channel
          ? channel.delete().then(() => null)
          : Promise.resolve(null);
      })
    );
    this.groupChannelsIdByGuildId[guild.id] = [];
    await this.saveState(guild);
  }

  public async broadcastMessage(
    guild: Guild,
    content: string | MessageEmbed,
    excludeGroupIds?: string[]
  ): Promise<Message[]> {
    let groupsId = this.groupChannelsIdByGuildId[guild.id];
    if (excludeGroupIds) {
      groupsId = groupsId.filter((id) => !excludeGroupIds.includes(id));
    }

    const channels = groupsId.reduce((memo, groupId) => {
      const maybeChannel = guild.channels.cache.find(
        (channel) => channel.id === groupId
      );
      if (maybeChannel && maybeChannel.type === "GUILD_TEXT") {
        memo.push(maybeChannel as TextChannel);
      }
      return memo;
    }, [] as TextChannel[]);

    const adminChannel = this.getAdminChannel(guild);
    if (adminChannel) {
      channels.push(adminChannel);
    }

    return await Promise.all(
      channels.map((channel) => {
        if (typeof content === "string") {
          return channel.send(content);
        } else {
          return channel.send({ embeds: [content] });
        }
      })
    );
  }

  private getCategoryIdByName(
    guild: Guild,
    categoryName: string
  ): string | undefined {
    return guild.channels.cache.find(
      (guildChannel) =>
        guildChannel.type === "GUILD_CATEGORY" &&
        guildChannel.name === categoryName
    )?.id;
  }

  private async saveState(guild: Guild): Promise<void> {
    try {
      await this.resourcesService.saveGuildResource(
        guild,
        MassMultiplayerEventService.STATE_FILE_NAME,
        JSON.stringify(this.groupChannelsIdByGuildId[guild.id])
      );
    } catch (error) {
      this.logger.error(
        MassMultiplayerEventService.LOG_LABEL,
        "Erreur à la sauvegare de l'état",
        { error }
      );
    }
  }

  private async loadState(guild: Guild): Promise<void> {
    try {
      if (
        await this.resourcesService.guildResourceExists(
          guild,
          MassMultiplayerEventService.STATE_FILE_NAME
        )
      ) {
        const raw = await this.resourcesService.readGuildResource(
          guild,
          `massMultiplayerEventsGroups.json`
        );
        if (raw) {
          const groupsId = JSON.parse(raw) as string[];
          this.groupChannelsIdByGuildId[guild.id] = groupsId;
        }
      }
    } catch (error) {
      this.logger.error(
        MassMultiplayerEventService.LOG_LABEL,
        "Erreur au chargement de l'état",
        { error }
      );
    }
  }
}
