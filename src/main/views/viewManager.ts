// Copyright (c) 2016-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.
import log from 'electron-log';
import {app, BrowserView, dialog, ipcMain, IpcMainEvent} from 'electron';

import {SECOND, TAB_BAR_HEIGHT} from 'common/utils/constants';
import {
    UPDATE_TARGET_URL,
    LOAD_SUCCESS,
    LOAD_FAILED,
    TOGGLE_LOADING_SCREEN_VISIBILITY,
    LOADSCREEN_END,
    SET_ACTIVE_VIEW,
    OPEN_TAB,
    BROWSER_HISTORY_PUSH,
    UPDATE_LAST_ACTIVE,
    UPDATE_URL_VIEW_WIDTH,
    MAIN_WINDOW_SHOWN,
    DARK_MODE_CHANGE,
    SERVERS_UPDATE,
    REACT_APP_INITIALIZED,
    LOADING_SCREEN_ANIMATION_FINISHED,
    BROWSER_HISTORY_BUTTON,
    APP_LOGGED_OUT,
    APP_LOGGED_IN,
    RELOAD_CURRENT_VIEW,
    UNREAD_RESULT,
} from 'common/communication';
import Config from 'common/config';
import urlUtils from 'common/utils/url';
import Utils from 'common/utils/util';
import {MattermostServer} from 'common/servers/MattermostServer';
import ServerManager from 'common/servers/serverManager';
import {TabView, TAB_MESSAGING} from 'common/tabs/TabView';

import {localizeMessage} from 'main/i18nManager';
import MainWindow from 'main/windows/mainWindow';

import {getLocalURLString, getLocalPreload, getWindowBoundaries} from '../utils';

import * as appState from '../appState';

import {MattermostView} from './MattermostView';
import modalManager from './modalManager';

const URL_VIEW_DURATION = 10 * SECOND;
const URL_VIEW_HEIGHT = 20;

enum LoadingScreenState {
    VISIBLE = 1,
    FADING = 2,
    HIDDEN = 3,
}

export class ViewManager {
    private closedViews: Map<string, {srv: MattermostServer; tab: TabView}>;
    private views: Map<string, MattermostView>;
    private currentView?: string;

    private urlViewCancel?: () => void;
    private loadingScreen?: BrowserView;
    private loadingScreenState: LoadingScreenState;

    constructor() {
        this.views = new Map(); // keep in mind that this doesn't need to hold server order, only tabs on the renderer need that.
        this.closedViews = new Map();
        this.loadingScreenState = LoadingScreenState.HIDDEN;

        ipcMain.on(REACT_APP_INITIALIZED, this.handleReactAppInitialized);
        ipcMain.on(LOADING_SCREEN_ANIMATION_FINISHED, this.handleLoadingScreenAnimationFinished);
        ipcMain.on(BROWSER_HISTORY_PUSH, this.handleBrowserHistoryPush);
        ipcMain.on(BROWSER_HISTORY_BUTTON, this.handleBrowserHistoryButton);
        ipcMain.on(APP_LOGGED_IN, this.handleAppLoggedIn);
        ipcMain.on(APP_LOGGED_OUT, this.handleAppLoggedOut);
        ipcMain.on(RELOAD_CURRENT_VIEW, this.handleReloadCurrentView);
        ipcMain.on(UNREAD_RESULT, this.handleFaviconIsUnread);

        ServerManager.on(SERVERS_UPDATE, this.handleReloadConfiguration);
    }

    init = () => {
        ServerManager.getAllServers().forEach((server) => this.loadServer(server));
        this.showInitial();
    }

    getView = (viewId: string) => {
        return this.views.get(viewId);
    }

    getCurrentView = () => {
        if (this.currentView) {
            return this.views.get(this.currentView);
        }

        return undefined;
    }

    getViewByWebContentsId = (webContentsId: number) => {
        return [...this.views.values()].find((view) => view.webContentsId === webContentsId);
    }

    isViewClosed = (viewId: string) => {
        return this.closedViews.has(viewId);
    }

    showById = (tabId: string) => {
        log.debug('viewManager.showById', tabId);

        const newView = this.views.get(tabId);
        if (newView) {
            if (newView.isVisible) {
                return;
            }
            let hidePrevious;
            if (this.currentView && this.currentView !== tabId) {
                const previous = this.getCurrentView();
                if (previous) {
                    hidePrevious = () => previous.hide();
                }
            }

            this.currentView = tabId;
            if (!newView.isErrored()) {
                newView.show();
                if (newView.needsLoadingScreen()) {
                    this.showLoadingScreen();
                }
            }
            hidePrevious?.();
            MainWindow.get()?.webContents.send(SET_ACTIVE_VIEW, newView.tab.server.id, newView.tab.id);
            ipcMain.emit(SET_ACTIVE_VIEW, true, newView.tab.server.id, newView.tab.id);
            if (newView.isReady()) {
                ipcMain.emit(UPDATE_LAST_ACTIVE, true, newView.tab.id);
            } else {
                log.warn(`couldn't show ${tabId}, not ready`);
            }
        } else {
            log.warn(`Couldn't find a view with name: ${tabId}`);
        }
        modalManager.showModal();
    }

    focusCurrentView = () => {
        log.debug('viewManager.focusCurrentView');

        if (modalManager.isModalDisplayed()) {
            modalManager.focusCurrentModal();
            return;
        }

        const view = this.getCurrentView();
        if (view) {
            view.focus();
        }
    }

    reload = () => {
        const currentView = this.getCurrentView();
        if (currentView) {
            this.showLoadingScreen();
            currentView.reload();
        }
    }

    sendToAllViews = (channel: string, ...args: unknown[]) => {
        this.views.forEach((view) => {
            if (!view.isDestroyed()) {
                view.sendToRenderer(channel, ...args);
            }
        });
    }

    sendToFind = () => {
        this.getCurrentView()?.openFind();
    }

    /**
     * Deep linking
     */

    handleDeepLink = (url: string | URL) => {
        // TODO: fix for new tabs
        if (url) {
            const parsedURL = urlUtils.parseURL(url)!;
            const tabView = ServerManager.lookupTabByURL(parsedURL, true);
            if (tabView) {
                const urlWithSchema = `${tabView.url.origin}${parsedURL.pathname}${parsedURL.search}`;
                if (this.closedViews.has(tabView.id)) {
                    this.openClosedTab(tabView.id, urlWithSchema);
                } else {
                    const view = this.views.get(tabView.id);
                    if (!view) {
                        log.error(`Couldn't find a view matching the name ${tabView.id}`);
                        return;
                    }

                    if (view.isReady() && ServerManager.getRemoteInfo(view.tab.server.id)?.serverVersion && Utils.isVersionGreaterThanOrEqualTo(ServerManager.getRemoteInfo(view.tab.server.id)?.serverVersion ?? '', '6.0.0')) {
                        const pathName = `/${urlWithSchema.replace(view.tab.server.url.toString(), '')}`;
                        view.sendToRenderer(BROWSER_HISTORY_PUSH, pathName);
                        this.deeplinkSuccess(view.id);
                    } else {
                        // attempting to change parsedURL protocol results in it not being modified.
                        view.resetLoadingStatus();
                        view.load(urlWithSchema);
                        view.once(LOAD_SUCCESS, this.deeplinkSuccess);
                        view.once(LOAD_FAILED, this.deeplinkFailed);
                    }
                }
            } else {
                dialog.showErrorBox(
                    localizeMessage('main.views.viewManager.handleDeepLink.error.title', 'No matching server'),
                    localizeMessage('main.views.viewManager.handleDeepLink.error.body', 'There is no configured server in the app that matches the requested url: {url}', {url: parsedURL.toString()}),
                );
            }
        }
    };

    private deeplinkSuccess = (viewId: string) => {
        log.debug('viewManager.deeplinkSuccess', viewId);

        this.showById(viewId);
        this.views.get(viewId)?.removeListener(LOAD_FAILED, this.deeplinkFailed);
    };

    private deeplinkFailed = (viewId: string, err: string, url: string) => {
        log.error(`[${viewId}] failed to load deeplink ${url}: ${err}`);
        this.views.get(viewId)?.removeListener(LOAD_SUCCESS, this.deeplinkSuccess);
    }

    /**
     * View loading helpers
     */

    private loadServer = (server: MattermostServer) => {
        const tabs = ServerManager.getOrderedTabsForServer(server.id);
        tabs.forEach((tab) => this.loadView(server, tab));
    }

    private loadView = (srv: MattermostServer, tab: TabView, url?: string) => {
        if (!tab.isOpen) {
            this.closedViews.set(tab.id, {srv, tab});
            return;
        }
        const view = this.makeView(srv, tab, url);
        this.addView(view);
    }

    private makeView = (srv: MattermostServer, tab: TabView, url?: string): MattermostView => {
        const mainWindow = MainWindow.get();
        if (!mainWindow) {
            throw new Error('Cannot create view, no main window present');
        }

        const view = new MattermostView(tab, mainWindow, {webPreferences: {spellcheck: Config.useSpellChecker}});
        view.once(LOAD_SUCCESS, this.activateView);
        view.on(LOADSCREEN_END, this.finishLoading);
        view.on(LOAD_FAILED, this.failLoading);
        view.on(UPDATE_TARGET_URL, this.showURLView);
        view.load(url);
        return view;
    }

    private addView = (view: MattermostView): void => {
        this.views.set(view.id, view);
        if (this.closedViews.has(view.id)) {
            this.closedViews.delete(view.id);
        }
        if (!this.loadingScreen) {
            this.createLoadingScreen();
        }
    }

    private showInitial = () => {
        log.verbose('viewManager.showInitial');

        if (ServerManager.hasServers()) {
            const lastActiveServer = ServerManager.getCurrentServer();
            const lastActiveTab = ServerManager.getLastActiveTabForServer(lastActiveServer.id);
            this.showById(lastActiveTab.id);
        } else {
            MainWindow.get()?.webContents.send(SET_ACTIVE_VIEW);
            ipcMain.emit(MAIN_WINDOW_SHOWN);
        }
    }

    /**
     * Mattermost view event handlers
     */

    private activateView = (viewId: string) => {
        log.debug('viewManager.activateView', viewId);

        if (this.currentView === viewId) {
            this.showById(this.currentView);
        }
    }

    private finishLoading = (viewId: string) => {
        log.debug('viewManager.finishLoading', viewId);

        if (this.currentView === viewId) {
            this.showById(this.currentView);
            this.fadeLoadingScreen();
        }
    }

    private failLoading = (viewId: string) => {
        log.debug('viewManager.failLoading', viewId);

        this.fadeLoadingScreen();
        if (this.currentView === viewId) {
            this.getCurrentView()?.hide();
        }
    }

    private showURLView = (url: URL | string) => {
        log.silly('viewManager.showURLView', url);

        const mainWindow = MainWindow.get();
        if (!mainWindow) {
            return;
        }

        if (this.urlViewCancel) {
            this.urlViewCancel();
        }
        if (url && url !== '') {
            const urlString = typeof url === 'string' ? url : url.toString();
            const preload = getLocalPreload('desktopAPI.js');
            const urlView = new BrowserView({
                webPreferences: {
                    preload,

                    // Workaround for this issue: https://github.com/electron/electron/issues/30993
                    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                    // @ts-ignore
                    transparent: true,
                }});
            const query = new Map([['url', urlString]]);
            const localURL = getLocalURLString('urlView.html', query);
            urlView.webContents.loadURL(localURL);
            MainWindow.get()?.addBrowserView(urlView);
            const boundaries = this.views.get(this.currentView || '')?.getBounds() ?? mainWindow.getBounds();

            const hideView = () => {
                delete this.urlViewCancel;
                try {
                    MainWindow.get()?.removeBrowserView(urlView);
                } catch (e) {
                    log.error('Failed to remove URL view', e);
                }

                // workaround to eliminate zombie processes
                // https://github.com/mattermost/desktop/pull/1519
                // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                // @ts-ignore
                urlView.webContents.destroy();
            };

            const adjustWidth = (event: IpcMainEvent, width: number) => {
                log.silly('showURLView.adjustWidth', width);

                const bounds = {
                    x: 0,
                    y: (boundaries.height + TAB_BAR_HEIGHT) - URL_VIEW_HEIGHT,
                    width: width + 5, // add some padding to ensure that we don't cut off the border
                    height: URL_VIEW_HEIGHT,
                };

                log.silly('showURLView setBounds', boundaries, bounds);
                urlView.setBounds(bounds);
            };

            ipcMain.on(UPDATE_URL_VIEW_WIDTH, adjustWidth);

            const timeout = setTimeout(hideView,
                URL_VIEW_DURATION);

            this.urlViewCancel = () => {
                clearTimeout(timeout);
                ipcMain.removeListener(UPDATE_URL_VIEW_WIDTH, adjustWidth);
                hideView();
            };
        }
    }

    /**
     * Loading Screen
     */

    setLoadingScreenBounds = () => {
        if (this.loadingScreen) {
            const mainWindow = MainWindow.get();
            if (!mainWindow) {
                return;
            }
            this.loadingScreen.setBounds(getWindowBoundaries(mainWindow));
        }
    }

    updateLoadingScreenDarkMode = (darkMode: boolean) => {
        if (this.loadingScreen) {
            this.loadingScreen.webContents.send(DARK_MODE_CHANGE, darkMode);
        }
    }

    isLoadingScreenHidden = () => {
        return this.loadingScreenState === LoadingScreenState.HIDDEN;
    }

    private showLoadingScreen = () => {
        const mainWindow = MainWindow.get();
        if (!mainWindow) {
            return;
        }

        if (!this.loadingScreen) {
            this.createLoadingScreen();
        }

        this.loadingScreenState = LoadingScreenState.VISIBLE;

        if (this.loadingScreen?.webContents.isLoading()) {
            this.loadingScreen.webContents.once('did-finish-load', () => {
                this.loadingScreen!.webContents.send(TOGGLE_LOADING_SCREEN_VISIBILITY, true);
            });
        } else {
            this.loadingScreen!.webContents.send(TOGGLE_LOADING_SCREEN_VISIBILITY, true);
        }

        if (mainWindow.getBrowserViews().includes(this.loadingScreen!)) {
            mainWindow.setTopBrowserView(this.loadingScreen!);
        } else {
            mainWindow.addBrowserView(this.loadingScreen!);
        }

        this.setLoadingScreenBounds();
    }

    private createLoadingScreen = () => {
        const preload = getLocalPreload('desktopAPI.js');
        this.loadingScreen = new BrowserView({webPreferences: {
            preload,

            // Workaround for this issue: https://github.com/electron/electron/issues/30993
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-ignore
            transparent: true,
        }});
        const localURL = getLocalURLString('loadingScreen.html');
        this.loadingScreen.webContents.loadURL(localURL);
    }

    private fadeLoadingScreen = () => {
        if (this.loadingScreen && this.loadingScreenState === LoadingScreenState.VISIBLE) {
            this.loadingScreenState = LoadingScreenState.FADING;
            this.loadingScreen.webContents.send(TOGGLE_LOADING_SCREEN_VISIBILITY, false);
        }
    }

    /**
     * Event Handlers
     */

    /** Called when a new configuration is received
     * Servers or tabs have been added or edited. We need to
     * close, open, or reload tabs, taking care to reuse tabs and
     * preserve focus on the currently selected tab. */
    private handleReloadConfiguration = () => {
        log.debug('viewManager.handleReloadConfiguration');

        const currentTabId: string | undefined = this.views.get(this.currentView as string)?.tab.id;

        const current: Map<string, MattermostView> = new Map();
        for (const view of this.views.values()) {
            current.set(view.tab.id, view);
        }

        const views: Map<string, MattermostView> = new Map();
        const closed: Map<string, {srv: MattermostServer; tab: TabView}> = new Map();

        const sortedTabs = ServerManager.getAllServers().flatMap((x) => ServerManager.getOrderedTabsForServer(x.id).
            map((t): [MattermostServer, TabView] => [x, t]));

        for (const [srv, tab] of sortedTabs) {
            const recycle = current.get(tab.id);
            if (!tab.isOpen) {
                closed.set(tab.id, {srv, tab});
            } else if (recycle) {
                views.set(tab.id, recycle);
            } else {
                views.set(tab.id, this.makeView(srv, tab));
            }
        }

        // commit the data to our local state
        // destroy everything that no longer exists
        for (const [k, v] of current) {
            if (!views.has(k)) {
                v.destroy();
            }
        }

        // commit views
        this.views = new Map();
        for (const x of views.values()) {
            this.views.set(x.id, x);
        }

        // commit closed
        for (const x of closed.values()) {
            this.closedViews.set(x.tab.id, {srv: x.srv, tab: x.tab});
        }

        if ((currentTabId && closed.has(currentTabId)) || (this.currentView && this.closedViews.has(this.currentView))) {
            if (ServerManager.hasServers()) {
                this.currentView = undefined;
                this.showInitial();
            } else {
                MainWindow.get()?.webContents.send(SET_ACTIVE_VIEW);
            }
        }

        // show the focused tab (or initial)
        if (currentTabId && views.has(currentTabId)) {
            const view = views.get(currentTabId);
            if (view && view.id !== this.currentView) {
                this.currentView = view.id;
                this.showById(view.id);
                MainWindow.get()?.webContents.send(SET_ACTIVE_VIEW, view.tab.server.id, view.tab.id);
            } else {
                this.focusCurrentView();
            }
        } else {
            this.showInitial();
        }
    }

    private handleAppLoggedIn = (event: IpcMainEvent, viewId: string) => {
        this.getView(viewId)?.onLogin(true);
    }

    private handleAppLoggedOut = (event: IpcMainEvent, viewId: string) => {
        this.getView(viewId)?.onLogin(false);
    }

    private handleBrowserHistoryPush = (e: IpcMainEvent, viewId: string, pathName: string) => {
        log.debug('WindowManager.handleBrowserHistoryPush', {viewId, pathName});

        const currentView = this.getView(viewId);
        const cleanedPathName = urlUtils.cleanPathName(currentView?.tab.server.url.pathname || '', pathName);
        const redirectedviewId = ServerManager.lookupTabByURL(`${currentView?.tab.server.url.toString().replace(/\/$/, '')}${cleanedPathName}`)?.id || viewId;
        if (this.isViewClosed(redirectedviewId)) {
            // If it's a closed view, just open it and stop
            this.openClosedTab(redirectedviewId, `${currentView?.tab.server.url}${cleanedPathName}`);
            return;
        }
        let redirectedView = this.getView(redirectedviewId) || currentView;
        if (redirectedView !== currentView && redirectedView?.tab.server.id === ServerManager.getCurrentServer().id && redirectedView?.isLoggedIn) {
            log.info('redirecting to a new view', redirectedView?.id || viewId);
            this.showById(redirectedView?.id || viewId);
        } else {
            redirectedView = currentView;
        }

        // Special case check for Channels to not force a redirect to "/", causing a refresh
        if (!(redirectedView !== currentView && redirectedView?.tab.type === TAB_MESSAGING && cleanedPathName === '/')) {
            redirectedView?.sendToRenderer(BROWSER_HISTORY_PUSH, cleanedPathName);
            if (redirectedView) {
                this.handleBrowserHistoryButton(e, redirectedView.id);
            }
        }
    }

    private handleBrowserHistoryButton = (e: IpcMainEvent, viewId: string) => {
        this.getView(viewId)?.updateHistoryButton();
    }

    private handleLoadingScreenAnimationFinished = () => {
        log.debug('WindowManager.handleLoadingScreenAnimationFinished');

        if (this.loadingScreen && this.loadingScreenState !== LoadingScreenState.HIDDEN) {
            this.loadingScreenState = LoadingScreenState.HIDDEN;
            MainWindow.get()?.removeBrowserView(this.loadingScreen);
        }

        if (process.env.NODE_ENV === 'test') {
            app.emit('e2e-app-loaded');
        }
    }

    private handleReactAppInitialized = (e: IpcMainEvent, viewId: string) => {
        log.debug('WindowManager.handleReactAppInitialized', viewId);

        const view = this.views.get(viewId);
        if (view) {
            view.setInitialized();
            if (this.getCurrentView() === view) {
                this.fadeLoadingScreen();
            }
        }
    }

    private handleReloadCurrentView = () => {
        log.debug('WindowManager.handleReloadCurrentView');

        const view = this.getCurrentView();
        if (!view) {
            return;
        }
        view?.reload();
        this.showById(view?.id);
    }

    // if favicon is null, it means it is the initial load,
    // so don't memoize as we don't have the favicons and there is no rush to find out.
    private handleFaviconIsUnread = (e: Event, favicon: string, viewId: string, result: boolean) => {
        log.silly('MattermostView.handleFaviconIsUnread', {favicon, viewId, result});

        appState.updateUnreads(viewId, result);
    }

    /**
     * Helper functions
     */

    private openClosedTab = (id: string, url?: string) => {
        if (!this.closedViews.has(id)) {
            return;
        }
        const {srv, tab} = this.closedViews.get(id)!;
        tab.isOpen = true;
        this.loadView(srv, tab, url);
        this.showById(id);
        const view = this.views.get(id)!;
        view.isVisible = true;
        view.on(LOAD_SUCCESS, () => {
            view.isVisible = false;
            this.showById(id);
        });
        ipcMain.emit(OPEN_TAB, null, tab.id);
    }
}

const viewManager = new ViewManager();
export default viewManager;
