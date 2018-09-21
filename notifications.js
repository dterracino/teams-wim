'use strict';

const defaultSettings = {
	ignoredConversations: [],
	ignoredUsers: [],
	onlyImportant: false,
	enabled: true
};

let settings = {
	ignoredConversations: [],
	ignoredUsers: [],
	onlyImportant: false,
	enabled: true
};

function updateIcon() {
	const title = (() => {
		if (settings.enabled === true) {
			return 'teams-wim: Notifications enabled';
		}
		return 'teams-wim: Notifications disabled';
	})();
	const icon = (() => {
		if (settings.enabled === true) {
			return 'icon.svg';
		}

		return 'icon-inactive.svg';
	})();
	browser.browserAction.setTitle({title: title});
	browser.browserAction.setIcon({
		path: {
			'16': icon,
			'32': icon,
			'64': icon,
		}
	});
}

function iconClicked(/* tab */) {
	settings.enabled = !settings.enabled;
	browser.storage.local.set({enabled: settings.enabled});
}

class EventMessage {
	constructor(eventMessage) {
		this.id = eventMessage.id;
		this.type = eventMessage.resourceType;
		this.resource = eventMessage.resource;
	}
}

class NewMessage {
	constructor(resource) {
		this.threadtype = resource.threadtype;
		this.type = resource.type;
		this.messagetype = resource.messagetype;
		this.contentType = resource.contenttype;
		this.sender = resource.imdisplayname;
		this.content = resource.content;
		this.sendTime = resource.composetime;
		this.receiveTime = resource.originalarrivaltime;
		this.properties = resource.properties;
		this.conversationLink = resource.conversationLink;
	}

	get conversation() {
		const conversationIdRegex = /conversations\/([0-9a-z:\-_]*)@/;
		const conversationIdMatch = this.conversationLink.match(conversationIdRegex);
		if (Array.isArray(conversationIdMatch) && (conversationIdMatch.length === 2)) {
			return conversationIdMatch[1];
		}

		return null;
	}

	get plainContent() {
		const content = valueOrDefault(this.content, '');
		return content.replace(/<[^>]*>/g, '');
	}

	get isImportant() {
		if (this.properties === undefined) {
			return false;
		}

		return this.properties.importance === 'high';
	}

	get isTeamMessage() {
		return this.threadtype === 'space';
	}

	get isChatMessage() {
		return this.threadtype === 'chat';
	}
}

// Determine if a message should trigger a notification (depending on the settings)
function filterMessage(newMessage) {
	if (newMessage.type !== 'Message') {
		return false;
	}

	if (settings.ignoredConversations.includes(newMessage.conversation)) {
		return false;
	}

	if (settings.ignoredUsers.includes(newMessage.sender)) {
		return false;
	}

	if (settings.onlyImportant) {
		return newMessage.isImportant;
	}

	return true;
}

function receive(json) {
	if (json.eventMessages !== undefined) {
		const eventMessages = json.eventMessages;
		eventMessages
			.map(json => new EventMessage(json))
			.filter(eventMessage => eventMessage.type === 'NewMessage')
			.map(eventMessage => new NewMessage(eventMessage.resource))
			.filter(filterMessage)
			.forEach(newMessage => {
				let description = '';
				description += newMessage.isImportant ? 'IMPORTANT ' : '';
				description += newMessage.isTeamMessage ? 'team ' : '';
				description += newMessage.isChatMessage ? 'chat ' : '';

				const title = `New ${description} message from ${newMessage.sender}`;
				browser.notifications.create({
					type: 'basic',
					'title': title,
					'message': newMessage.plainContent,
				});
			});
	}
}

function listener(details) {
	if (settings.enabled === false) {
		return;
	}

	const url = details.url;
	if (!url.includes('poll')) {
		return;
	}
	let filter = browser.webRequest.filterResponseData(details.requestId);
	let decoder = new TextDecoder('utf-8');

	let json = '';

	filter.ondata = event => {
		json += decoder.decode(event.data, {stream: true});
		filter.write(event.data);
	};

	filter.onerror = function () {
		filter.disconnect();
	};

	filter.onstop = function () {
		filter.disconnect();
		receive(JSON.parse(json));
	};
}

function valueOrDefault(value, defaultValue) {
	if (value === undefined) {
		return defaultValue;
	}

	return value;
}

browser.webRequest.onBeforeRequest.addListener(
	listener,
	{urls: ['https://*.teams.microsoft.com/*'], types: ['xmlhttprequest']},
	['blocking']
);

browser.browserAction.onClicked.addListener(iconClicked);

browser.storage.local.get().then(loadedSettings => {
	for (const setting in defaultSettings) {
		settings[setting] = valueOrDefault(loadedSettings[setting], defaultSettings[setting]);
	}
}).then(() => updateIcon());

browser.storage.onChanged.addListener((changes, areaName) => {
	if (areaName === 'local') {
		for (const setting in changes) {
			settings[setting] = valueOrDefault(changes[setting].newValue, defaultSettings[setting]);
		}
		updateIcon();
	}
});

