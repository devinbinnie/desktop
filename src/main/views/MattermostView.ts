// Copyright (c) 2016-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import path from 'path';

import {EventEmitter} from 'events';

import {
    BrowserView,
    BrowserViewConstructorOptions,
    BrowserWindow,
    CookiesSetDetails,
    IpcMainEvent,
    OnBeforeSendHeadersListenerDetails,
    OnHeadersReceivedListenerDetails,
    Rectangle,
    session,
} from 'electron';
import log from 'electron-log';

import {Headers} from 'types/webRequest';

import {LOAD_SUCCESS, SET_VIEW_OPTIONS} from 'common/communication';
import {MattermostServer} from 'common/servers/MattermostServer';
import {TabView} from 'common/tabs/TabView';

import {ServerInfo} from 'main/server/serverInfo';
import {createCookieSetDetailsFromCookieString, getLocalPreload, getLocalURLString, getWindowBoundaries, makeCSPHeader} from 'main/utils';
import WebRequestManager from 'main/webRequest/webRequestManager';
import WindowManager from 'main/windows/windowManager';

export class MattermostView extends EventEmitter {
    // TODO
    name: string;
    tab: TabView;
    serverInfo: ServerInfo;
    window: BrowserWindow;
    view: BrowserView;
    isAtRoot: boolean;
    isVisible: boolean;

    cookies: Map<string, CookiesSetDetails>;

    constructor(tab: TabView, serverInfo: ServerInfo, window: BrowserWindow, options: BrowserViewConstructorOptions) {
        super();

        // TODO
        this.name = tab.name;
        this.tab = tab;
        this.serverInfo = serverInfo;
        this.window = window;
        this.isVisible = false;
        this.isAtRoot = false;

        const preload = getLocalPreload('mainWindow.js');
        this.view = new BrowserView({
            ...options,
            webPreferences: {
                preload,
            },
        });

        // Don't cache the remote_entry script
        WebRequestManager.onRequestHeaders(this.addNoCacheForRemoteEntryRequest, this.view.webContents.id);

        // URL handling
        WebRequestManager.rewriteURL(
            new RegExp(`file:///${path.resolve('/').replace('\\', '/').replace('/', '')}(${this.tab.server.url.pathname})?/(api|static|plugins)/(.*)`, 'g'),
            `${this.tab.server.url}/$2/$3`,
            this.view.webContents.id,
        );

        WebRequestManager.rewriteURL(
            new RegExp(`file://(${this.tab.server.url.pathname})?/(api|static|plugins)/(.*)`, 'g'),
            `${this.tab.server.url}/$2/$3`,
            this.view.webContents.id,
        );

        WebRequestManager.rewriteURL(
            new RegExp(`file:///${path.resolve('/').replace('\\', '/')}(\\?.+)?$`, 'g'),
            `${getLocalURLString('index.html')}$1`,
            this.view.webContents.id,
        );

        WebRequestManager.onResponseHeaders(this.addCSPHeader, this.view.webContents.id);

        // Cookies
        this.cookies = new Map();
        WebRequestManager.onRequestHeaders(this.appendCookies, this.view.webContents.id);
        WebRequestManager.onResponseHeaders(this.extractCookies, this.view.webContents.id);

        // Websocket
        WebRequestManager.onRequestHeaders(this.addOriginForWebsocket, this.view.webContents.id);
    }

    get serverUrl() {
        let url = `${this.tab.server.url}`;
        if (url.endsWith('/')) {
            url = url.slice(0, url.length - 1);
        }
        return url;
    }

    private addNoCacheForRemoteEntryRequest = (details: OnBeforeSendHeadersListenerDetails) => {
        log.silly('WindowManager.addNoCacheForRemoteEntry', details.requestHeaders);

        if (!details.url.match(new RegExp(`${this.serverUrl}/static/remote_entry.js`))) {
            return {} as Headers;
        }

        return {
            'Cache-Control': 'max-age=0',
        };
    }

    private addOriginForWebsocket = (details: OnBeforeSendHeadersListenerDetails) => {
        log.silly('WindowManager.addOriginForWebsocket', details.requestHeaders);

        if (!details.url.startsWith('ws')) {
            return {} as Headers;
        }

        if (!(details.requestHeaders.Origin === 'file://')) {
            return {};
        }

        return {
            Origin: `${this.tab.server.url.protocol}//${this.tab.server.url.host}`,
        };
    }

    setCookie = async (event: IpcMainEvent, cookie: string) => {
        log.debug('MattermostView.setCookie', this.tab.name, cookie);
        const cookieSetDetails = createCookieSetDetailsFromCookieString(cookie, `${this.tab.server.url}`, this.tab.server.url.host);
        if (this.cookies.has(cookieSetDetails.name) && this.cookies.get(cookieSetDetails.name)?.value === cookieSetDetails.value) {
            return;
        }
        await session.defaultSession.cookies.set(cookieSetDetails);
        this.cookies.set(cookieSetDetails.name, cookieSetDetails);
    }

    setupCookies = async () => {
        log.debug('MattermostView.setupCookies', this.tab.name);
        const cookies = await session.defaultSession.cookies.get({
            domain: this.tab.server.url.host,
            path: this.tab.server.url.pathname,
        });
        cookies.forEach((cookie) => {
            this.cookies.set(cookie.name, {
                ...cookie,
                url: `${this.serverUrl}`,
            });
        });
        return this.cookies;
    }

    private appendCookies = (details: OnBeforeSendHeadersListenerDetails) => {
        log.debug('MattermostView.appendCookies', details.requestHeaders, this.cookies);
        return {
            Cookie: `${details.requestHeaders.Cookie ? `${details.requestHeaders.Cookie}; ` : ''}${[...this.cookies.values()].map((cookie) => `${cookie.name}=${cookie.value}`).join('; ')}`,
        };
    }

    private extractCookies = (details: OnHeadersReceivedListenerDetails) => {
        if (!details.responseHeaders) {
            return {};
        }

        const cookieHeaderName = Object.keys(details.responseHeaders).find((key) => key.toLowerCase() === 'set-cookie');
        if (cookieHeaderName) {
            const cookies = details.responseHeaders[cookieHeaderName] as string[];
            cookies.forEach((cookie) => {
                const cookieResult = createCookieSetDetailsFromCookieString(cookie, `${this.serverUrl}`, this.tab.server.url.host);
                this.cookies.set(cookieResult.name, cookieResult);

                session.defaultSession.cookies.set(cookieResult).then(() => {
                    return session.defaultSession.cookies.flushStore();
                }).catch((err) => {
                    log.error('An error occurring setting cookies', err);
                });
            });
        }
        return {};
    }

    private addCSPHeader = (details: OnHeadersReceivedListenerDetails) => {
        if (details.url.startsWith(getLocalURLString('index.html'))) {
            return {
                'Content-Security-Policy': [makeCSPHeader(this.tab.server.url, this.serverInfo.remoteInfo.cspHeader)],
            };
        }

        return {} as Headers;
    };

    isLoggedIn = () => {
        return Boolean(this.cookies.get('MMAUTHTOKEN')?.value);
    }

    load = (someURL?: string | URL) => {
        log.debug('MattermostView.load', `${someURL}`);

        // TODO

        // if (!this.tab) {
        //     return;
        // }

        // let loadURL: string;
        // if (someURL) {
        //     const parsedURL = urlUtils.parseURL(someURL);
        //     if (parsedURL) {
        //         loadURL = parsedURL.toString();
        //     } else {
        //         log.error('Cannot parse provided url, using current server url', someURL);
        //         loadURL = this.tab.url.toString();
        //     }
        // } else {
        //     loadURL = this.tab.url.toString();
        // }
        const url = `${getLocalURLString('index.html')}#${this.tab.url.toString().replace(new RegExp(`${this.serverUrl}(/)?`), '/')}`;
        const loading = this.view.webContents.loadURL(url); //, {userAgent: composeUserAgent()});
        loading.then(this.loadSuccess(url));
        // ).catch((err) => {
        //     if (err.code && err.code.startsWith('ERR_CERT')) {
        //         WindowManager.sendToRenderer(LOAD_FAILED, this.tab.name, err.toString(), loadURL.toString());
        //         this.emit(LOAD_FAILED, this.tab.name, err.toString(), loadURL.toString());
        //         log.info(`[${Util.shorten(this.tab.name)}] Invalid certificate, stop retrying until the user decides what to do: ${err}.`);
        //         this.status = Status.ERROR;
        //         return;
        //     }
        //     this.loadRetry(loadURL, err);
        // });
    };

    private loadSuccess = (loadURL: string) => {
        return () => {
            //log.info(`[${Util.shorten(this.tab.name)}] finished loading ${loadURL}`);
            WindowManager.sendToRenderer(LOAD_SUCCESS, this.tab.name);
            //this.maxRetries = MAX_SERVER_RETRIES;
            // if (this.status === Status.LOADING) {
            //     ipcMain.on(UNREAD_RESULT, this.handleFaviconIsUnread);
            //     this.updateMentionsFromTitle(this.view.webContents.getTitle());
            //     this.findUnreadState(null);
            // }
            // this.status = Status.WAITING_MM;
            // this.removeLoading = setTimeout(this.setInitialized, MAX_LOADING_SCREEN_SECONDS, true);
            this.emit(LOAD_SUCCESS, this.tab.name, loadURL);
            this.setBounds(getWindowBoundaries(this.window));
        };
    }

    updateServerInfo = (srv: MattermostServer) => {
        log.info('MattermostView.updateServerInfo', srv);

        this.tab.server = srv;
        const newServerInfo = new ServerInfo(srv);
        newServerInfo.promise.then(() => {
            this.serverInfo = newServerInfo;
        });
        this.view.webContents.send(SET_VIEW_OPTIONS, this.tab.name, this.tab.shouldNotify);
    };

    destroy = () => {
        log.debug('MattermostView.destroy');

        // TODO

        // WebContentsEventManager.removeWebContentsListeners(this.view.webContents.id);
        // appState.updateMentions(this.tab.name, 0, false);
        if (this.window) {
            this.window.removeBrowserView(this.view);
        }

        // workaround to eliminate zombie processes
        // https://github.com/mattermost/desktop/pull/1519
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        this.view.webContents.destroy();

        this.isVisible = false;
        // if (this.retryLoad) {
        //     clearTimeout(this.retryLoad);
        // }
        // if (this.removeLoading) {
        //     clearTimeout(this.removeLoading);
        // }
    };

    isErrored = () => {
        log.debug('MattermostView.isErrored');

        // TODO
        return false;
    };

    isReady = () => {
        log.debug('MattermostView.isReady');

        // TODO
        return true;
    };

    reload = () => {
        log.info('MattermostView.reload');

        this.resetLoadingStatus();
        this.load();
    };

    show = (requestedVisibility = true) => {
        log.info('MattermostView.show', this.tab.name, requestedVisibility);

        // TODO
        // this.window.addBrowserView(this.view);
        // this.view.setBounds({
        //     ...this.window.getBounds(),
        //     x: 0,
        //     y: 0,
        // });
        // this.isVisible = true;

        // this.hasBeenShown = true;
        const request = requestedVisibility;
        if (request && !this.isVisible) {
            this.window.addBrowserView(this.view);
            this.setBounds(getWindowBoundaries(this.window));
            // if (this.status === Status.READY) {
            //     this.focus();
            // }
        } else if (!request && this.isVisible) {
            this.window.removeBrowserView(this.view);
        }
        this.isVisible = request;
    };

    hide = () => this.show(false);

    focus = () => {
        log.debug('MattermostView.focus');

        if (this.view.webContents) {
            this.view.webContents.focus();
        } else {
            log.warn('trying to focus the browserview, but it doesn\'t yet have webcontents.');
        }
    };

    setBounds = (bounds: Rectangle) => {
        log.debug('MattermostView.setBounds', bounds);

        this.view.setBounds(bounds);
    };

    needsLoadingScreen = () => {
        log.debug('MattermostView.needsLoadingScreen');

        // TODO
        return false;
    };

    resetLoadingStatus = () => {
        log.debug('MattermostView.resetLoadingStatus');

        // TODO
    };

    setInitialized = () => {
        log.debug('MattermostView.setInitialized');

        // TODO
    };

    isInitialized = () => {
        log.debug('MattermostView.isInitialized');

        // TODO
        return true;
    };

    handleTitleUpdate = () => {
        log.debug('MattermostView.handleTitleUpdate');

        // TODO
    };

    handleFaviconUpdate = () => {
        log.debug('MattermostView.handleFaviconUpdate');

        // TODO
    };

    handleUpdateTarget = () => {
        log.debug('MattermostView.handleUpdateTarget');

        // TODO
    };

    handleDidNavigate = () => {
        log.debug('MattermostView.handleDidNavigate');

        // TODO
    };
}
