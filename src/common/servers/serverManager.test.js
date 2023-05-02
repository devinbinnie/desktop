// Copyright (c) 2016-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {TAB_MESSAGING, TAB_FOCALBOARD, TAB_PLAYBOOKS} from 'common/tabs/TabView';
import {parseURL, isInternalURL} from 'common/utils/url';
import Utils from 'common/utils/util';

import {ServerManager} from './serverManager';

jest.mock('common/config', () => ({
    set: jest.fn(),
}));
jest.mock('common/utils/url', () => ({
    parseURL: jest.fn(),
    isInternalURL: jest.fn(),
}));
jest.mock('common/utils/util', () => ({
    isVersionGreaterThanOrEqualTo: jest.fn(),
}));
jest.mock('main/server/serverInfo', () => ({
    ServerInfo: jest.fn(),
}));

describe('common/servers/serverManager', () => {
    describe('updateRemoteInfos', () => {
        const serverManager = new ServerManager();

        beforeEach(() => {
            const server = {id: 'server-1', url: new URL('http://server-1.com'), name: 'server-1'};
            server.updateURL = (url) => {
                server.url = new URL(url);
            };
            serverManager.servers = new Map([['server-1', server]]);
            serverManager.tabs = new Map([
                ['tab-1', {id: 'tab-1', type: TAB_MESSAGING, isOpen: true, server}],
                ['tab-2', {id: 'tab-2', type: TAB_PLAYBOOKS, server}],
                ['tab-3', {id: 'tab-3', type: TAB_FOCALBOARD, server}],
            ]);
            serverManager.tabOrder = new Map([['server-1', ['tab-1', 'tab-2', 'tab-3']]]);
            serverManager.persistServers = jest.fn();
            Utils.isVersionGreaterThanOrEqualTo.mockImplementation((version) => version === '6.0.0');
        });

        it('should not save when there is nothing to update', () => {
            serverManager.updateRemoteInfos(new Map([['server-1', {
                siteURL: 'http://server-1.com',
                serverVersion: '6.0.0',
                hasPlaybooks: false,
                hasFocalboard: false,
            }]]));

            expect(serverManager.persistServers).not.toHaveBeenCalled();
        });

        it('should open all tabs', async () => {
            serverManager.updateRemoteInfos(new Map([['server-1', {
                siteURL: 'http://server-1.com',
                serverVersion: '6.0.0',
                hasPlaybooks: true,
                hasFocalboard: true,
            }]]));

            expect(serverManager.tabs.get('tab-2').isOpen).toBe(true);
            expect(serverManager.tabs.get('tab-3').isOpen).toBe(true);
        });

        it('should open only playbooks', async () => {
            serverManager.updateRemoteInfos(new Map([['server-1', {
                siteURL: 'http://server-1.com',
                serverVersion: '6.0.0',
                hasPlaybooks: true,
                hasFocalboard: false,
            }]]));

            expect(serverManager.tabs.get('tab-2').isOpen).toBe(true);
            expect(serverManager.tabs.get('tab-3').isOpen).toBeUndefined();
        });

        it('should open none when server version is too old', async () => {
            serverManager.updateRemoteInfos(new Map([['server-1', {
                siteURL: 'http://server-1.com',
                serverVersion: '5.0.0',
                hasPlaybooks: true,
                hasFocalboard: true,
            }]]));

            expect(serverManager.tabs.get('tab-2').isOpen).toBeUndefined();
            expect(serverManager.tabs.get('tab-3').isOpen).toBeUndefined();
        });

        it('should update server URL using site URL', async () => {
            serverManager.updateRemoteInfos(new Map([['server-1', {
                siteURL: 'http://server-2.com',
                serverVersion: '6.0.0',
                hasPlaybooks: true,
                hasFocalboard: true,
            }]]));

            expect(serverManager.servers.get('server-1').url.toString()).toBe('http://server-2.com/');
        });
    });

    describe('lookupTabByURL', () => {
        const serverManager = new ServerManager();
        serverManager.getAllServers = () => [
            {id: 'server-1', url: new URL('http://server-1.com')},
            {id: 'server-2', url: new URL('http://server-2.com/subpath')},
        ];
        serverManager.getOrderedTabsForServer = (serverId) => {
            if (serverId === 'server-1') {
                return [
                    {id: 'tab-1', url: new URL('http://server-1.com')},
                    {id: 'tab-1-type-1', url: new URL('http://server-1.com/type1')},
                    {id: 'tab-1-type-2', url: new URL('http://server-1.com/type2')},
                ];
            }
            if (serverId === 'server-2') {
                return [
                    {id: 'tab-2', url: new URL('http://server-2.com/subpath')},
                    {id: 'tab-2-type-1', url: new URL('http://server-2.com/subpath/type1')},
                    {id: 'tab-2-type-2', url: new URL('http://server-2.com/subpath/type2')},
                ];
            }
            return [];
        };

        beforeEach(() => {
            parseURL.mockImplementation((url) => new URL(url));
            isInternalURL.mockImplementation((url1, url2) => `${url1}`.startsWith(`${url2}`));
        });

        afterEach(() => {
            jest.resetAllMocks();
        });

        it('should match the correct server - base URL', () => {
            const inputURL = new URL('http://server-1.com');
            expect(serverManager.lookupTabByURL(inputURL)).toStrictEqual({id: 'tab-1', url: new URL('http://server-1.com')});
        });

        it('should match the correct server - base tab', () => {
            const inputURL = new URL('http://server-1.com/team');
            expect(serverManager.lookupTabByURL(inputURL)).toStrictEqual({id: 'tab-1', url: new URL('http://server-1.com')});
        });

        it('should match the correct server - different tab', () => {
            const inputURL = new URL('http://server-1.com/type1/app');
            expect(serverManager.lookupTabByURL(inputURL)).toStrictEqual({id: 'tab-1-type-1', url: new URL('http://server-1.com/type1')});
        });

        it('should return undefined for server with subpath and URL without', () => {
            const inputURL = new URL('http://server-2.com');
            expect(serverManager.lookupTabByURL(inputURL)).toBe(undefined);
        });

        it('should return undefined for server with subpath and URL with wrong subpath', () => {
            const inputURL = new URL('http://server-2.com/different/subpath');
            expect(serverManager.lookupTabByURL(inputURL)).toBe(undefined);
        });

        it('should match the correct server with a subpath - base URL', () => {
            const inputURL = new URL('http://server-2.com/subpath');
            expect(serverManager.lookupTabByURL(inputURL)).toStrictEqual({id: 'tab-2', url: new URL('http://server-2.com/subpath')});
        });

        it('should match the correct server with a subpath - base tab', () => {
            const inputURL = new URL('http://server-2.com/subpath/team');
            expect(serverManager.lookupTabByURL(inputURL)).toStrictEqual({id: 'tab-2', url: new URL('http://server-2.com/subpath')});
        });

        it('should match the correct server with a subpath - different tab', () => {
            const inputURL = new URL('http://server-2.com/subpath/type2/team');
            expect(serverManager.lookupTabByURL(inputURL)).toStrictEqual({id: 'tab-2-type-2', url: new URL('http://server-2.com/subpath/type2')});
        });

        it('should return undefined for wrong server', () => {
            const inputURL = new URL('http://server-3.com');
            expect(serverManager.lookupTabByURL(inputURL)).toBe(undefined);
        });
    });
});
