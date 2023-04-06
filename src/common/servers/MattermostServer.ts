// Copyright (c) 2016-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {v4 as uuid} from 'uuid';

import {Team} from 'types/config';

import urlUtils from 'common/utils/url';

export class MattermostServer {
    id: string;
    name: string;
    url!: URL;
    isPredefined: boolean;

    constructor(server: Team, isPredefined = false) {
        this.id = uuid();
        this.name = server.name;
        this.updateURL(server.url);
        this.isPredefined = isPredefined;
        if (!this.url) {
            throw new Error('Invalid url for creating a server');
        }
    }

    updateURL = (url: string) => {
        this.url = urlUtils.parseURL(url)!;
        if (!this.url) {
            throw new Error('Invalid url for creating a server');
        }
    }
}
