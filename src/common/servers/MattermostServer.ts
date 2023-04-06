// Copyright (c) 2016-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {v4 as uuid} from 'uuid';

import {MattermostTeam, Team} from 'types/config';

import urlUtils from 'common/utils/url';

export class MattermostServer {
    id: string;
    name: string;
    url!: URL;
    isPredefined: boolean;

    constructor(server: Team, isPredefined: boolean) {
        this.id = uuid();

        this.name = server.name;
        this.updateURL(server.url);

        this.isPredefined = isPredefined;
    }

    updateURL = (url: string) => {
        this.url = urlUtils.parseURL(url)!;
        if (!this.url) {
            throw new Error('Invalid url for creating a server');
        }
    }

    toMattermostTeam = (): MattermostTeam => {
        return {
            name: this.name,
            url: this.url.toString(),
            id: this.id,
            isPredefined: this.isPredefined,
        };
    }
}
