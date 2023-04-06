// Copyright (c) 2016-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {BrowserView, ipcMain, IpcMainEvent, IpcMainInvokeEvent} from 'electron';

import {CombinedConfig} from 'types/config';
import {DownloadedItem, DownloadedItems} from 'types/downloads';

import {
    CLOSE_DOWNLOADS_DROPDOWN,
    EMIT_CONFIGURATION,
    OPEN_DOWNLOADS_DROPDOWN,
    RECEIVE_DOWNLOADS_DROPDOWN_SIZE,
    REQUEST_CLEAR_DOWNLOADS_DROPDOWN,
    REQUEST_DOWNLOADS_DROPDOWN_INFO,
    UPDATE_DOWNLOADS_DROPDOWN,
    UPDATE_DOWNLOADS_DROPDOWN_MENU_ITEM,
    GET_DOWNLOADED_IMAGE_THUMBNAIL_LOCATION,
    DOWNLOADS_DROPDOWN_OPEN_FILE,
} from 'common/communication';
import {Logger} from 'common/log';
import Config from 'common/config';
import {TAB_BAR_HEIGHT, DOWNLOADS_DROPDOWN_WIDTH, DOWNLOADS_DROPDOWN_HEIGHT, DOWNLOADS_DROPDOWN_FULL_WIDTH} from 'common/utils/constants';

import {getLocalPreload, getLocalURLString} from 'main/utils';
import downloadsManager from 'main/downloadsManager';
import WindowManager from 'main/windows/windowManager';
import MainWindow from 'main/windows/mainWindow';

const log = new Logger('DownloadsDropdownView');

export default class DownloadsDropdownView {
    bounds?: Electron.Rectangle;
    darkMode: boolean;
    downloads: DownloadedItems;
    item?: DownloadedItem;
    view: BrowserView;
    windowBounds: Electron.Rectangle;

    constructor() {
        this.downloads = downloadsManager.getDownloads();
        this.darkMode = Config.darkMode;

        ipcMain.on(OPEN_DOWNLOADS_DROPDOWN, this.handleOpen);
        ipcMain.on(CLOSE_DOWNLOADS_DROPDOWN, this.handleClose);
        ipcMain.on(EMIT_CONFIGURATION, this.updateConfig);
        ipcMain.on(REQUEST_DOWNLOADS_DROPDOWN_INFO, this.updateDownloadsDropdown);
        ipcMain.on(REQUEST_CLEAR_DOWNLOADS_DROPDOWN, this.clearDownloads);
        ipcMain.on(RECEIVE_DOWNLOADS_DROPDOWN_SIZE, this.handleReceivedDownloadsDropdownSize);
        ipcMain.on(DOWNLOADS_DROPDOWN_OPEN_FILE, this.openFile);
        ipcMain.on(UPDATE_DOWNLOADS_DROPDOWN, this.updateDownloads);
        ipcMain.on(UPDATE_DOWNLOADS_DROPDOWN_MENU_ITEM, this.updateDownloadsDropdownMenuItem);
        ipcMain.handle(GET_DOWNLOADED_IMAGE_THUMBNAIL_LOCATION, this.getDownloadImageThumbnailLocation);

        const mainWindow = MainWindow.get();
        const windowBounds = MainWindow.getBounds();
        if (!(mainWindow && windowBounds)) {
            throw new Error('Cannot initialize downloadsDropdownView, missing MainWindow');
        }

        this.windowBounds = windowBounds;
        this.bounds = this.getBounds(DOWNLOADS_DROPDOWN_FULL_WIDTH, DOWNLOADS_DROPDOWN_HEIGHT);

        const preload = getLocalPreload('desktopAPI.js');
        this.view = new BrowserView({webPreferences: {
            preload,

            // Workaround for this issue: https://github.com/electron/electron/issues/30993
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-ignore
            transparent: true,
        }});

        this.view.webContents.loadURL(getLocalURLString('downloadsDropdown.html'));
        this.view.webContents.session.webRequest.onHeadersReceived(downloadsManager.webRequestOnHeadersReceivedHandler);
        mainWindow.addBrowserView(this.view);
    }

    updateDownloads = (event: IpcMainEvent, downloads: DownloadedItems) => {
        log.debug('updateDownloads', {downloads});

        this.downloads = downloads;

        this.updateDownloadsDropdown();
    }

    updateDownloadsDropdownMenuItem = (event: IpcMainEvent, item?: DownloadedItem) => {
        log.debug('updateDownloadsDropdownMenuItem', {item});
        this.item = item;
        this.updateDownloadsDropdown();
    }

    updateConfig = (event: IpcMainEvent, config: CombinedConfig) => {
        log.debug('updateConfig');

        this.darkMode = config.darkMode;
        this.updateDownloadsDropdown();
    }

    /**
     * This is called every time the "window" is resized so that we can position
     * the downloads dropdown at the correct position
     */
    updateWindowBounds = () => {
        log.debug('updateWindowBounds');

        const mainWindow = MainWindow.get();
        if (mainWindow) {
            this.windowBounds = mainWindow.getContentBounds();
            this.updateDownloadsDropdown();
            this.repositionDownloadsDropdown();
        }
    }

    updateDownloadsDropdown = () => {
        log.debug('updateDownloadsDropdown');

        this.view.webContents.send(
            UPDATE_DOWNLOADS_DROPDOWN,
            this.downloads,
            this.darkMode,
            this.windowBounds,
            this.item,
        );
    }

    handleOpen = () => {
        log.debug('handleOpen', {bounds: this.bounds});

        if (!this.bounds) {
            return;
        }

        this.view.setBounds(this.bounds);
        MainWindow.get()?.setTopBrowserView(this.view);
        this.view.webContents.focus();
        downloadsManager.onOpen();
        WindowManager.sendToRenderer(OPEN_DOWNLOADS_DROPDOWN);
    }

    handleClose = () => {
        log.debug('handleClose');

        this.view.setBounds(this.getBounds(0, 0));
        downloadsManager.onClose();
        WindowManager.sendToRenderer(CLOSE_DOWNLOADS_DROPDOWN);
    }

    clearDownloads = () => {
        downloadsManager.clearDownloadsDropDown();
        this.handleClose();
    }

    openFile = (e: IpcMainEvent, item: DownloadedItem) => {
        log.debug('openFile', {item});

        downloadsManager.openFile(item);
    }

    getBounds = (width: number, height: number) => {
        // Must always use integers
        return {
            x: this.getX(this.windowBounds.width),
            y: this.getY(),
            width: Math.round(width),
            height: Math.round(height),
        };
    }

    getX = (windowWidth: number) => {
        const result = windowWidth - DOWNLOADS_DROPDOWN_FULL_WIDTH;
        if (result <= DOWNLOADS_DROPDOWN_WIDTH) {
            return 0;
        }
        return Math.round(result);
    }

    getY = () => {
        return Math.round(TAB_BAR_HEIGHT);
    }

    repositionDownloadsDropdown = () => {
        if (!(this.bounds && this.windowBounds)) {
            return;
        }
        this.bounds = {
            ...this.bounds,
            x: this.getX(this.windowBounds.width),
            y: this.getY(),
        };
        if (downloadsManager.getIsOpen()) {
            this.view.setBounds(this.bounds);
        }
    }

    handleReceivedDownloadsDropdownSize = (event: IpcMainEvent, width: number, height: number) => {
        log.silly('handleReceivedDownloadsDropdownSize', {width, height});

        this.bounds = this.getBounds(width, height);
        if (downloadsManager.getIsOpen()) {
            this.view.setBounds(this.bounds);
        }
    }

    destroy = () => {
        // workaround to eliminate zombie processes
        // https://github.com/mattermost/desktop/pull/1519
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        this.view.webContents.destroy();
    }

    getDownloadImageThumbnailLocation = (event: IpcMainInvokeEvent, location: string) => {
        return location;
    }
}
