import * as stringify from "json-stringify-safe";
import * as NodeCache from "node-cache";
import { ApolloGraphClient } from "../../../graph/ApolloGraphClient";
import { GraphClient } from "../../../spi/graph/GraphClient";
import { logger } from "../../util/logger";
import {
    CommandIncoming,
    EventIncoming,
    isCommandIncoming,
    isEventIncoming,
} from "../RequestProcessor";
import { WebSocketClientOptions } from "./WebSocketClient";
import { RegistrationConfirmation } from "./WebSocketRequestProcessor";

/**
 * Factory for creating GraphClient instances for incoming commands and events.
 *
 * Uses a cache to store GraphClient instances for 5 mins after which new instances will be given out.
 */
export class GraphClientFactory {

    private graphClients = new NodeCache({ stdTTL: 1 * 60, checkperiod: 1 * 30, useClones: false });

    public createGraphClient(event: CommandIncoming | EventIncoming,
                             config: {
                                options: WebSocketClientOptions,
                                 headers: { [name: string]: string },
                            }): GraphClient {
        let teamId;
        if (isCommandIncoming(event)) {
            teamId = event.team.id;
        } else if (isEventIncoming(event)) {
            teamId = event.extensions.team_id;
        }

        if (this.graphClients.get(teamId)) {
            logger.debug("Re-using cached graph client for team '%s'", teamId);
            return this.graphClients.get(teamId);
        } else if (config.options) {
            logger.debug("Creating new graph client for team '%s'", teamId);
            const graphClient = new ApolloGraphClient(`${config.options.graphUrl}/${teamId}`, config.headers);
            this.graphClients.set(teamId, graphClient);
            return graphClient;
        } else {
            logger.debug("Unable to create graph client for team '%s' and registration '$s'",
                teamId, stringify(config));
            return null;
        }
    }
}
