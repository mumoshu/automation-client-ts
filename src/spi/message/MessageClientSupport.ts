import { SlackMessage } from "@atomist/slack-messages";
import { toStringArray } from "../../internal/util/string";
import { GraphClient } from "../graph/GraphClient";
import {
    addressSlackChannels,
    addressSlackUsers,
    Destination,
    MessageClient,
    MessageOptions, SlackMessageClient,
} from "./MessageClient";

export abstract class MessageClientSupport implements MessageClient {

    public respond(msg: any,
                   options?: MessageOptions): Promise<any> {
        return this.doSend(msg, [], options);
    }

    public send(msg: any,
                destinations: Destination | Destination[],
                options?: MessageOptions): Promise<any> {
        if (!Array.isArray(destinations)) {
            destinations = [ destinations ];
        }
        return this.doSend(msg, destinations as Destination[], options);
    }

    protected abstract doSend(msg: any,
                              destinations: Destination[],
                              options?: MessageOptions): Promise<any>;

}

export const Query = `
query ChatTeam {
  ChatTeam {
    id
  }
}`;

export class DefaultSlackMessageClient implements MessageClient, SlackMessageClient {

    constructor(private delegate: MessageClient, private graphClient: GraphClient) {}

    public respond(msg: any,
                   options?: MessageOptions): Promise<any> {
        return this.delegate.respond(msg, options);
    }

    public send(msg: any,
                destinations: Destination | Destination[],
                options?: MessageOptions): Promise<any> {
        return this.delegate.send(msg, destinations, options);
    }

    public addressUsers(msg: string | SlackMessage,
                        users: string | string[],
                        options?: MessageOptions): Promise<any> {
        return this.lookupChatTeam()
            .then(chatTeamId =>
                this.delegate.send(msg, addressSlackUsers(chatTeamId, ...toStringArray(users)), options));
    }

    public addressChannels(msg: string | SlackMessage,
                           channels: string | string[],
                           options?: MessageOptions): Promise<any> {
        return this.lookupChatTeam()
            .then(chatTeamId =>
                this.delegate.send(msg, addressSlackChannels(chatTeamId, ...toStringArray(channels)), options));

    }

    private lookupChatTeam(): Promise<string> {
        if (this.graphClient) {
            return this.graphClient.executeQuery<any, any>(Query, {})
                .then(result => {
                    if (result.ChatTeam.length > 1) {
                        return Promise.reject("More then 1 ChatTeam found. Please use fully qualified " +
                            "message addressing available on MessageClient");
                    } else {
                        return result.ChatTeam[0].id;
                    }
                });
        } else {
            return Promise.reject("No GraphClient to lookup ChatTeam. Please use fully qualified message " +
                "addressing available on MessageClient");
        }
    }
}
