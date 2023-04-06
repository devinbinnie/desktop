// Copyright (c) 2016-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

'use strict';

import {TAB_BAR_HEIGHT, THREE_DOT_MENU_WIDTH, THREE_DOT_MENU_WIDTH_MAC, MENU_SHADOW_WIDTH} from 'common/utils/constants';

import MainWindow from 'main/windows/mainWindow';

import TeamDropdownView from './teamDropdownView';

jest.mock('main/utils', () => ({
    getLocalPreload: (file) => file,
    getLocalURLString: (file) => file,
}));

jest.mock('electron', () => ({
    BrowserView: jest.fn().mockImplementation(() => ({
        webContents: {
            loadURL: jest.fn(),
            focus: jest.fn(),
        },
        setBounds: jest.fn(),
    })),
    ipcMain: {
        on: jest.fn(),
    },
}));
jest.mock('main/windows/mainWindow', () => ({
    get: jest.fn(),
    getBounds: jest.fn(),
    addBrowserView: jest.fn(),
    setTopBrowserView: jest.fn(),
}));
jest.mock('../windows/windowManager', () => ({
    sendToRenderer: jest.fn(),
}));

jest.mock('common/servers/serverManager', () => ({
    on: jest.fn(),
    getOrderedServers: jest.fn().mockReturnValue([]),
}));

describe('main/views/teamDropdownView', () => {
    describe('getBounds', () => {
        beforeEach(() => {
            MainWindow.getBounds.mockReturnValue({width: 500, height: 400, x: 0, y: 0});
        });

        const teamDropdownView = new TeamDropdownView();
        if (process.platform === 'darwin') {
            it('should account for three dot menu, tab bar and shadow', () => {
                expect(teamDropdownView.getBounds(400, 300)).toStrictEqual({x: THREE_DOT_MENU_WIDTH_MAC - MENU_SHADOW_WIDTH, y: TAB_BAR_HEIGHT - MENU_SHADOW_WIDTH, width: 400, height: 300});
            });
        } else {
            it('should account for three dot menu, tab bar and shadow', () => {
                expect(teamDropdownView.getBounds(400, 300)).toStrictEqual({x: THREE_DOT_MENU_WIDTH - MENU_SHADOW_WIDTH, y: TAB_BAR_HEIGHT - MENU_SHADOW_WIDTH, width: 400, height: 300});
            });
        }
    });

    it('should change the view bounds based on open/closed state', () => {
        const teamDropdownView = new TeamDropdownView();
        teamDropdownView.bounds = {width: 400, height: 300};
        teamDropdownView.handleOpen();
        expect(teamDropdownView.view.setBounds).toBeCalledWith(teamDropdownView.bounds);
        teamDropdownView.handleClose();
        expect(teamDropdownView.view.setBounds).toBeCalledWith({width: 0, height: 0, x: expect.any(Number), y: expect.any(Number)});
    });
});
