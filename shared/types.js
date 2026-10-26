"use strict";
// 宿命公牌 (Dora Hold'em) - 全局共享类型定义
Object.defineProperty(exports, "__esModule", { value: true });
exports.GameEndReason = exports.TurnActionType = exports.HandRank = exports.SUITS = exports.RANKS = exports.SUIT_COLORS = exports.SUIT_SYMBOLS = void 0;
exports.SUIT_SYMBOLS = {
    s: '♠',
    h: '♥',
    c: '♣',
    d: '♦',
};
exports.SUIT_COLORS = {
    s: 'black',
    h: 'red',
    c: 'black',
    d: 'red',
};
exports.RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];
exports.SUITS = ['s', 'h', 'c', 'd'];
/**
 * 德州扑克牌型等级（从大到小）
 */
var HandRank;
(function (HandRank) {
    HandRank[HandRank["HIGH_CARD"] = 1] = "HIGH_CARD";
    HandRank[HandRank["ONE_PAIR"] = 2] = "ONE_PAIR";
    HandRank[HandRank["TWO_PAIR"] = 3] = "TWO_PAIR";
    HandRank[HandRank["THREE_OF_A_KIND"] = 4] = "THREE_OF_A_KIND";
    HandRank[HandRank["STRAIGHT"] = 5] = "STRAIGHT";
    HandRank[HandRank["FLUSH"] = 6] = "FLUSH";
    HandRank[HandRank["FULL_HOUSE"] = 7] = "FULL_HOUSE";
    HandRank[HandRank["FOUR_OF_A_KIND"] = 8] = "FOUR_OF_A_KIND";
    HandRank[HandRank["STRAIGHT_FLUSH"] = 9] = "STRAIGHT_FLUSH";
    HandRank[HandRank["ROYAL_FLUSH"] = 10] = "ROYAL_FLUSH";
})(HandRank || (exports.HandRank = HandRank = {}));
/**
 * 5大行动枚举
 */
var TurnActionType;
(function (TurnActionType) {
    TurnActionType["DISCARD_DRAW"] = "DISCARD_DRAW";
    TurnActionType["MANIPULATE_SWAP"] = "MANIPULATE_SWAP";
    TurnActionType["MANIPULATE_BANISH"] = "MANIPULATE_BANISH";
    TurnActionType["EXPAND_BOARD"] = "EXPAND_BOARD";
    TurnActionType["FOLD"] = "FOLD";
    TurnActionType["CALL_SHOWDOWN"] = "CALL_SHOWDOWN";
})(TurnActionType || (exports.TurnActionType = TurnActionType = {}));
/**
 * 终局触发方式
 */
var GameEndReason;
(function (GameEndReason) {
    GameEndReason["VOLUNTARY_SHOWDOWN"] = "voluntary_showdown";
    GameEndReason["DECK_DEPLETED"] = "deck_depleted";
    GameEndReason["LONE_SURVIVOR"] = "lone_survivor";
})(GameEndReason || (exports.GameEndReason = GameEndReason = {}));
