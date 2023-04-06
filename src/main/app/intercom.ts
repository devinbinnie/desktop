// Copyright (c) 2016-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {app, dialog, IpcMainEvent, IpcMainInvokeEvent, Menu} from 'electron';

import {Team, MattermostTeam} from 'types/config';
import {MentionData} from 'types/notification';

import Config from 'common/config';
import {Logger} from 'common/log';
import {ping} from 'common/utils/requests';

import {displayMention} from 'main/notifications';
import {getLocalPreload, getLocalURLString} from 'main/utils';
import ServerManager from 'common/servers/serverManager';
import ModalManager from 'main/views/modalManager';
import WindowManager from 'main/windows/windowManager';
import MainWindow from 'main/windows/mainWindow';

import {handleAppBeforeQuit} from './app';

const log = new Logger('App.Intercom');

export function handleAppVersion() {
    return {
        name: app.getName(),
        version: app.getVersion(),
    };
}

export function handleQuit(e: IpcMainEvent, reason: string, stack: string) {
    log.error(`Exiting App. Reason: ${reason}`);
    log.info(`Stacktrace:\n${stack}`);
    handleAppBeforeQuit();
    app.quit();
}

export function handleSwitchServer(event: IpcMainEvent, serverId: string) {
    log.silly('handleSwitchServer', serverId);
    WindowManager.switchServer(serverId);
}

export function handleSwitchTab(event: IpcMainEvent, tabId: string) {
    log.silly('handleSwitchTab', {tabId});
    WindowManager.switchTab(tabId);
}

export function handleCloseTab(event: IpcMainEvent, tabId: string) {
    log.debug('handleCloseTab', {tabId});

    const tab = ServerManager.getTab(tabId);
    if (!tab) {
        return;
    }
    ServerManager.setTabIsOpen(tabId, false);
    const nextTab = ServerManager.getLastActiveTabForServer(tab.server.id);
    WindowManager.switchTab(nextTab.id);
}

export function handleOpenTab(event: IpcMainEvent, tabId: string) {
    log.debug('handleOpenTab', {tabId});

    ServerManager.setTabIsOpen(tabId, true);
    WindowManager.switchTab(tabId);
}

export function handleGetOrderedServers() {
    return ServerManager.getOrderedServers().map((srv) => srv.toMattermostTeam());
}

export function handleGetOrderedTabsForServer(event: IpcMainInvokeEvent, serverId: string) {
    return ServerManager.getOrderedTabsForServer(serverId).map((tab) => tab.toMattermostTab());
}

export function handleGetLastActive() {
    const server = ServerManager.getCurrentServer();
    const tab = ServerManager.getLastActiveTabForServer(server.id);
    return {server: server.id, tab: tab.id};
}

function handleShowOnboardingScreens(showWelcomeScreen: boolean, showNewServerModal: boolean, mainWindowIsVisible: boolean) {
    log.debug('handleShowOnboardingScreens', {showWelcomeScreen, showNewServerModal, mainWindowIsVisible});

    if (showWelcomeScreen) {
        handleWelcomeScreenModal();

        if (process.env.NODE_ENV === 'test') {
            const welcomeScreen = ModalManager.modalQueue.find((modal) => modal.key === 'welcomeScreen');
            if (welcomeScreen?.view.webContents.isLoading()) {
                welcomeScreen?.view.webContents.once('did-finish-load', () => {
                    app.emit('e2e-app-loaded');
                });
            } else {
                app.emit('e2e-app-loaded');
            }
        }

        return;
    }
    if (showNewServerModal) {
        handleNewServerModal();
    }
}

export function handleMainWindowIsShown() {
    // eslint-disable-next-line no-undef
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    const showWelcomeScreen = () => !(Boolean(__SKIP_ONBOARDING_SCREENS__) || ServerManager.hasServers());
    const showNewServerModal = () => !ServerManager.hasServers();

    /**
     * The 2 lines above need to be functions, otherwise the mainWindow.once() callback from previous
     * calls of this function will notification re-evaluate the booleans passed to "handleShowOnboardingScreens".
    */

    const mainWindow = MainWindow.get();

    log.debug('handleMainWindowIsShown', {showWelcomeScreen, showNewServerModal, mainWindow: Boolean(mainWindow)});
    if (mainWindow?.isVisible()) {
        handleShowOnboardingScreens(showWelcomeScreen(), showNewServerModal(), true);
    } else {
        mainWindow?.once('show', () => {
            handleShowOnboardingScreens(showWelcomeScreen(), showNewServerModal(), false);
        });
    }
}

export function handleNewServerModal() {
    log.debug('handleNewServerModal');

    const html = getLocalURLString('newServer.html');

    const preload = getLocalPreload('desktopAPI.js');

    const mainWindow = MainWindow.get();
    if (!mainWindow) {
        return;
    }
    const modalPromise = ModalManager.addModal<MattermostTeam[], Team>('newServer', html, preload, ServerManager.getAllServers().map((team) => team.toMattermostTeam()), mainWindow, !ServerManager.hasServers());
    if (modalPromise) {
        modalPromise.then((data) => {
            const newTeam = ServerManager.addServer(data);
            WindowManager.switchServer(newTeam.id, true);
        }).catch((e) => {
            // e is undefined for user cancellation
            if (e) {
                log.error(`there was an error in the new server modal: ${e}`);
            }
        });
    } else {
        log.warn('There is already a new server modal');
    }
}

export function handleEditServerModal(e: IpcMainEvent, id: string) {
    log.debug('handleEditServerModal', id);

    const html = getLocalURLString('editServer.html');

    const preload = getLocalPreload('desktopAPI.js');

    const mainWindow = MainWindow.get();
    if (!mainWindow) {
        return;
    }
    const server = ServerManager.getServer(id);
    if (!server) {
        return;
    }
    const modalPromise = ModalManager.addModal<{currentTeams: MattermostTeam[]; team: MattermostTeam}, Team>(
        'editServer',
        html,
        preload,
        {
            currentTeams: ServerManager.getAllServers().map((team) => team.toMattermostTeam()),
            team: server.toMattermostTeam(),
        },
        mainWindow);
    if (modalPromise) {
        modalPromise.then((data) => ServerManager.editServer(id, data)).catch((e) => {
            // e is undefined for user cancellation
            if (e) {
                log.error(`there was an error in the edit server modal: ${e}`);
            }
        });
    } else {
        log.warn('There is already an edit server modal');
    }
}

export function handleRemoveServerModal(e: IpcMainEvent, id: string) {
    log.debug('handleRemoveServerModal', id);

    const html = getLocalURLString('removeServer.html');

    const preload = getLocalPreload('desktopAPI.js');

    const server = ServerManager.getServer(id);
    if (!server) {
        return;
    }
    const mainWindow = MainWindow.get();
    if (!mainWindow) {
        return;
    }
    const modalPromise = ModalManager.addModal<string, boolean>('removeServer', html, preload, server.name, mainWindow);
    if (modalPromise) {
        modalPromise.then((remove) => {
            if (remove) {
                ServerManager.removeServer(server.id);
            }
        }).catch((e) => {
            // e is undefined for user cancellation
            if (e) {
                log.error(`there was an error in the edit server modal: ${e}`);
            }
        });
    } else {
        log.warn('There is already an edit server modal');
    }
}

export function handleWelcomeScreenModal() {
    log.debug('handleWelcomeScreenModal');

    const html = getLocalURLString('welcomeScreen.html');

    const preload = getLocalPreload('desktopAPI.js');

    const mainWindow = MainWindow.get();
    if (!mainWindow) {
        return;
    }
    const modalPromise = ModalManager.addModal<MattermostTeam[], MattermostTeam>('welcomeScreen', html, preload, ServerManager.getAllServers().map((team) => team.toMattermostTeam()), mainWindow, !ServerManager.hasServers());
    if (modalPromise) {
        modalPromise.then((data) => {
            const newTeam = ServerManager.addServer(data);
            WindowManager.switchServer(newTeam.id, true);
        }).catch((e) => {
            // e is undefined for user cancellation
            if (e) {
                log.error(`there was an error in the welcome screen modal: ${e}`);
            }
        });
    } else {
        log.warn('There is already a welcome screen modal');
    }
}

export function handleMentionNotification(event: IpcMainEvent, title: string, body: string, channel: {id: string}, teamId: string, url: string, silent: boolean, data: MentionData) {
    log.debug('handleMentionNotification', {title, body, channel, teamId, url, silent, data});
    displayMention(title, body, channel, teamId, url, silent, event.sender, data);
}

export function handleOpenAppMenu() {
    log.debug('handleOpenAppMenu');

    const windowMenu = Menu.getApplicationMenu();
    if (!windowMenu) {
        log.error('No application menu found');
        return;
    }
    windowMenu.popup({
        window: MainWindow.get(),
        x: 18,
        y: 18,
    });
}

export async function handleSelectDownload(event: IpcMainInvokeEvent, startFrom: string) {
    log.debug('handleSelectDownload', startFrom);

    const message = 'Specify the folder where files will download';
    const result = await dialog.showOpenDialog({defaultPath: startFrom || Config.downloadLocation,
        message,
        properties:
     ['openDirectory', 'createDirectory', 'dontAddToRecent', 'promptToCreate']});
    return result.filePaths[0];
}

export function handleUpdateLastActive(event: IpcMainEvent, tabId: string) {
    log.debug('handleUpdateLastActive', {tabId});

    ServerManager.updateLastActive(tabId);
}

export function handlePingDomain(event: IpcMainInvokeEvent, url: string): Promise<string> {
    return Promise.allSettled([
        ping(new URL(`https://${url}`)),
        ping(new URL(`http://${url}`)),
    ]).then(([https, http]): string => {
        if (https.status === 'fulfilled') {
            return 'https';
        } else if (http.status === 'fulfilled') {
            return 'http';
        }
        throw new Error('Could not find server ' + url);
    });
}
