// Copyright (c) 2016-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import ServerManager from 'common/servers/serverManager';
import {getDefaultConfigTeamFromTeam} from 'common/tabs/TabView';

import ModalManager from 'main/views/modalManager';
import {getLocalURLString, getLocalPreload} from 'main/utils';
import MainWindow from 'main/windows/mainWindow';
import ViewManager from 'main/views/viewManager';

import * as Servers from './servers';

jest.mock('electron', () => ({
    ipcMain: {
        emit: jest.fn(),
    },
}));

jest.mock('common/servers/serverManager', () => ({
    setTabIsOpen: jest.fn(),
    getAllServers: jest.fn(),
    hasServers: jest.fn(),
    addServer: jest.fn(),
    editServer: jest.fn(),
    removeServer: jest.fn(),
    getServer: jest.fn(),
    getTab: jest.fn(),
    getLastActiveTabForServer: jest.fn(),
    getServerLog: jest.fn(),
}));
jest.mock('common/tabs/TabView', () => ({
    getDefaultConfigTeamFromTeam: jest.fn(),
}));
jest.mock('main/views/modalManager', () => ({
    addModal: jest.fn(),
}));
jest.mock('main/utils', () => ({
    getLocalPreload: jest.fn(),
    getLocalURLString: jest.fn(),
}));
jest.mock('main/windows/mainWindow', () => ({
    get: jest.fn(),
    show: jest.fn(),
}));
jest.mock('main/views/viewManager', () => ({
    getView: jest.fn(),
    showById: jest.fn(),
}));

const tabs = [
    {
        name: 'tab-1',
        order: 0,
        isOpen: false,
    },
    {
        name: 'tab-2',
        order: 2,
        isOpen: true,
    },
    {
        name: 'tab-3',
        order: 1,
        isOpen: true,
    },
];
const teams = [
    {
        id: 'server-1',
        name: 'server-1',
        url: 'http://server-1.com',
        tabs,
    },
];

describe('main/app/servers', () => {
    describe('switchServer', () => {
        const views = new Map([
            ['tab-1', {id: 'tab-1'}],
            ['tab-2', {id: 'tab-2'}],
            ['tab-3', {id: 'tab-3'}],
        ]);

        beforeEach(() => {
            jest.useFakeTimers();
            const server1 = {
                id: 'server-1',
            };
            const server2 = {
                id: 'server-2',
            };
            ServerManager.getServer.mockImplementation((name) => {
                switch (name) {
                case 'server-1':
                    return server1;
                case 'server-2':
                    return server2;
                default:
                    return undefined;
                }
            });
            ServerManager.getServerLog.mockReturnValue({debug: jest.fn(), error: jest.fn()});
            ViewManager.getView.mockImplementation((viewId) => views.get(viewId));
        });

        afterEach(() => {
            jest.resetAllMocks();
        });

        afterAll(() => {
            jest.runOnlyPendingTimers();
            jest.clearAllTimers();
            jest.useRealTimers();
        });

        it('should do nothing if cannot find the server', () => {
            Servers.switchServer('server-3');
            expect(ViewManager.showById).not.toBeCalled();
        });

        it('should show first open tab in order when last active not defined', () => {
            ServerManager.getLastActiveTabForServer.mockReturnValue({id: 'tab-3'});
            Servers.switchServer('server-1');
            expect(ViewManager.showById).toHaveBeenCalledWith('tab-3');
        });

        it('should show last active tab of chosen server', () => {
            ServerManager.getLastActiveTabForServer.mockReturnValue({id: 'tab-2'});
            Servers.switchServer('server-2');
            expect(ViewManager.showById).toHaveBeenCalledWith('tab-2');
        });

        it('should wait for view to exist if specified', () => {
            ServerManager.getLastActiveTabForServer.mockReturnValue({id: 'tab-3'});
            views.delete('tab-3');
            Servers.switchServer('server-1', true);
            expect(ViewManager.showById).not.toBeCalled();

            jest.advanceTimersByTime(200);
            expect(ViewManager.showById).not.toBeCalled();

            views.set('tab-3', {});
            jest.advanceTimersByTime(200);
            expect(ViewManager.showById).toBeCalledWith('tab-3');
        });
    });

    describe('handleNewServerModal', () => {
        let teamsCopy;

        beforeEach(() => {
            getLocalURLString.mockReturnValue('/some/index.html');
            getLocalPreload.mockReturnValue('/some/preload.js');
            MainWindow.get.mockReturnValue({});

            teamsCopy = JSON.parse(JSON.stringify(teams));
            ServerManager.getAllServers.mockReturnValue([]);
            ServerManager.addServer.mockImplementation(() => {
                const newTeam = {
                    id: 'server-1',
                    name: 'new-team',
                    url: 'http://new-team.com',
                    tabs,
                };
                teamsCopy = [
                    ...teamsCopy,
                    newTeam,
                ];
                return newTeam;
            });
            ServerManager.hasServers.mockReturnValue(Boolean(teamsCopy.length));
            ServerManager.getServerLog.mockReturnValue({debug: jest.fn(), error: jest.fn()});

            getDefaultConfigTeamFromTeam.mockImplementation((team) => ({
                ...team,
                tabs,
            }));
        });

        it('should add new team to the config', async () => {
            const data = {
                name: 'new-team',
                url: 'http://new-team.com',
            };
            const promise = Promise.resolve(data);
            ModalManager.addModal.mockReturnValue(promise);

            Servers.handleNewServerModal();
            await promise;

            expect(ServerManager.addServer).toHaveBeenCalledWith(data);
            expect(teamsCopy).toContainEqual(expect.objectContaining({
                id: 'server-1',
                name: 'new-team',
                url: 'http://new-team.com',
                tabs,
            }));

            // TODO: For some reason jest won't recognize this as being called
            //expect(spy).toHaveBeenCalledWith('server-1', true);
        });
    });

    describe('handleEditServerModal', () => {
        let teamsCopy;

        beforeEach(() => {
            getLocalURLString.mockReturnValue('/some/index.html');
            getLocalPreload.mockReturnValue('/some/preload.js');
            MainWindow.get.mockReturnValue({});

            teamsCopy = JSON.parse(JSON.stringify(teams));
            ServerManager.getServer.mockImplementation((id) => {
                if (id !== teamsCopy[0].id) {
                    return undefined;
                }
                return {...teamsCopy[0], toMattermostTeam: jest.fn()};
            });
            ServerManager.editServer.mockImplementation((id, team) => {
                if (id !== teamsCopy[0].id) {
                    return;
                }
                const newTeam = {
                    ...teamsCopy[0],
                    ...team,
                };
                teamsCopy = [newTeam];
            });
            ServerManager.getAllServers.mockReturnValue(teamsCopy.map((team) => ({...team, toMattermostTeam: jest.fn()})));
        });

        it('should do nothing when the server cannot be found', () => {
            Servers.handleEditServerModal(null, 'bad-server');
            expect(ModalManager.addModal).not.toBeCalled();
        });

        it('should edit the existing team', async () => {
            const promise = Promise.resolve({
                name: 'new-team',
                url: 'http://new-team.com',
            });
            ModalManager.addModal.mockReturnValue(promise);

            Servers.handleEditServerModal(null, 'server-1');
            await promise;
            expect(teamsCopy).not.toContainEqual(expect.objectContaining({
                id: 'server-1',
                name: 'server-1',
                url: 'http://server-1.com',
                tabs,
            }));
            expect(teamsCopy).toContainEqual(expect.objectContaining({
                id: 'server-1',
                name: 'new-team',
                url: 'http://new-team.com',
                tabs,
            }));
        });
    });

    describe('handleRemoveServerModal', () => {
        let teamsCopy;

        beforeEach(() => {
            getLocalURLString.mockReturnValue('/some/index.html');
            getLocalPreload.mockReturnValue('/some/preload.js');
            MainWindow.get.mockReturnValue({});

            teamsCopy = JSON.parse(JSON.stringify(teams));
            ServerManager.getServer.mockImplementation((id) => {
                if (id !== teamsCopy[0].id) {
                    return undefined;
                }
                return teamsCopy[0];
            });
            ServerManager.removeServer.mockImplementation(() => {
                teamsCopy = [];
            });
            ServerManager.getAllServers.mockReturnValue(teamsCopy);
        });

        it('should remove the existing team', async () => {
            const promise = Promise.resolve(true);
            ModalManager.addModal.mockReturnValue(promise);

            Servers.handleRemoveServerModal(null, 'server-1');
            await promise;
            expect(teamsCopy).not.toContainEqual(expect.objectContaining({
                id: 'server-1',
                name: 'server-1',
                url: 'http://server-1.com',
                tabs,
            }));
        });

        it('should not remove the existing team when clicking Cancel', async () => {
            const promise = Promise.resolve(false);
            ModalManager.addModal.mockReturnValue(promise);

            expect(teamsCopy).toContainEqual(expect.objectContaining({
                id: 'server-1',
                name: 'server-1',
                url: 'http://server-1.com',
                tabs,
            }));

            Servers.handleRemoveServerModal(null, 'server-1');
            await promise;
            expect(teamsCopy).toContainEqual(expect.objectContaining({
                id: 'server-1',
                name: 'server-1',
                url: 'http://server-1.com',
                tabs,
            }));
        });
    });
});
