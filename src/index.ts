import { ClientOptions, Cloudflare } from 'cloudflare';
import { AAAARecord, ARecord } from 'cloudflare/src/resources/dns/records.js';
type AddressableRecord = AAAARecord | ARecord;

enum GateUpdateType {
	DefaultOnly = 'Default',
	All = 'All',
}

function successResponse(): Response {
	return new Response('OK', { status: 200 });
}

class HttpError extends Error {
	constructor(
		public statusCode: number,
		message: string,
	) {
		super(message);
		this.name = 'HttpError';
	}
}

function validateChangeRequest(request: Request, env: Env): { cloudflareApiToken: string, updateHostIp: boolean, updateGatewayIp: boolean, gatewayUpdateType: GateUpdateType, record: AddressableRecord } {
	const url = new URL(request.url);
	const params = url.searchParams;
	const domain = params.get('domain');
	
	if (domain === null) {
		throw new HttpError(400, 'The "domain" parameter is required and cannot be empty.');
	}

	const clientApiKeyName = domain + '_' +'CLIENT_API_KEY';
	if (!(clientApiKeyName in env)) {
		console.log('Client API Key not configured for domain \'' + domain + '\'.');
		throw new HttpError(401, 'Domain \'' + domain + '\' not configured for updates.');
	}

	const cloudflareApiTokenName = domain + '_' +'CLOUDFLARE_API_TOKEN';
	if (!(cloudflareApiTokenName in env)) {
		console.log('Cloudflare API Token not configured for domain \'' + domain + '\'.');
		throw new HttpError(401, 'Domain \'' + domain + '\' not configured for updates.');
	}

	const clientApiKey = env[clientApiKeyName as keyof Env];
	const cloudflareApiToken = env[cloudflareApiTokenName as keyof Env];

	const authorization = request.headers.get('Authorization');
	if (!authorization) {
		throw new HttpError(401, 'Authorization header missing.');
	}

	const [, data] = authorization.split(' ');
	const decoded = atob(data);

	// Check for control characters (null, ASCII 0-31, DEL) which could be used in injection attacks
	if (/[\0-\x1F\x7F]/.test(decoded)) {
		throw new HttpError(401, 'Invalid API key or token.');
	}

	// Only client API key is expected in the header, so ignore if 'some' password is passed
	const index = decoded.indexOf(':');
	const requestApiKey = index === -1 ? decoded : decoded.substring(0, index);

	if (!requestApiKey || requestApiKey !== clientApiKey) {
		throw new HttpError(401, 'Request failed client authentication');
	}
	console.log('Client authenticated successfully!');

	let ip = params.get('ip') || params.get('myip');
	if (ip === null) {
		throw new HttpError(422, 'The "ip" parameter is required and cannot be empty. Specify ip=auto to use the client IP.');
	} else if (ip == 'auto') {
		ip = request.headers.get('CF-Connecting-IP');
		if (ip === null) {
			throw new HttpError(500, 'Request asked for ip=auto but client IP address cannot be determined.');
		}
	}

	return {
		cloudflareApiToken: cloudflareApiToken,
		updateHostIp: params.has('hostname'),
		updateGatewayIp: params.has('gateway'),
		gatewayUpdateType: params.get('gateway') === 'All' ? GateUpdateType.All : GateUpdateType.DefaultOnly,
		record: {
			content: ip,
			name: params.get('hostname') ?? undefined,
			type: ip.includes('.') ? 'A' : 'AAAA',
			ttl: 1,
		}
	};
}

async function updateDNSRecord(cloudflare: Cloudflare, zoneId: string, newRecord: AddressableRecord): Promise<Response> {

	const records = (
		await cloudflare.dns.records.list({
			zone_id: zoneId,
			name: newRecord.name as any,
			type: newRecord.type,
		})
	).result;

	if (records.length > 1) {
		throw new HttpError(400, 'More than one matching record found!');
	} else if (records.length === 0 || records[0].id === undefined) {
		throw new HttpError(400, 'No record found! You must first manually create the record.');
	}

	// Extract current properties
	const currentRecord = records[0] as AddressableRecord;
	const proxied = currentRecord.proxied ?? false; // Default to `false` if `proxied` is undefined
	const comment = currentRecord.comment;
	const oldIp = currentRecord.content;

	try {
		await cloudflare.dns.records.update(records[0].id, {
			content: newRecord.content,
			zone_id: zoneId,
			name: newRecord.name as any,
			type: newRecord.type,
			proxied, // Pass the existing "proxied" status
			comment, // Pass the existing "comment"
		});
		console.log('DNS record for ' + newRecord.name + '(' + newRecord.type + ') updated successfully from ' + oldIp + ' to ' + newRecord.content);
	} catch (error) {
		console.error('Failed to update DNS record:', newRecord, 'Error:', error);
		throw error;
	}

	return successResponse();
}

async function updateGatewayLocation(cloudflare: Cloudflare, accountId: string, newRecord: AddressableRecord, updateType: GateUpdateType = GateUpdateType.DefaultOnly): Promise<Response> {

	console.log('Starting Zero Trust Gateway location updates ...');

	// Get the locations
	const locations = (await cloudflare.zeroTrust.gateway.locations.list({ account_id: accountId })).result;
	if (locations.length === 0) {
		console.log('No Zero Trust Gateway locations found!');
		return successResponse();
	}
	console.log('Number of locations found:', locations.length);

	const ip = newRecord.content as string;

	// Format IP as CIDR notation
	const networkCIDR = ip.includes(':') 
		? `${ip}/128`  // IPv6
		: `${ip}/32`;  // IPv4
	
	// Update each location with the new IP
	for (const location of locations) {

		console.log('Processing location:', {
			name: location.name,
			networks: location.networks,
			client_default: location.client_default
		});

		if (!location.client_default && updateType === GateUpdateType.DefaultOnly) {
			console.log('Skipping non-default location:', location.name);
			continue;
		}
		
		if (location.id) {
			const locationName = location.name || 'Default Location';
			try {
				// Update with the same name and new network
				await cloudflare.zeroTrust.gateway.locations.update(location.id, {
					account_id: accountId,
					name: locationName,
					client_default: location.client_default,
					networks: [{
						network: networkCIDR
					}]
				});
				console.log('Zero Trust Gateway location \'' + locationName + '\' updated successfully with network \'' + networkCIDR + '\'');
			} catch (error) {
				console.error('Failed to update Zero Trust Gateway location:', locationName, 'Error:', error);
				throw error; // Re-throw to maintain the original error handling
			}
		} else {
			console.warn('Skipping location without ID:', location);
		}
	}	
	return successResponse();

}

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		console.log('Requester IP: ' + request.headers.get('CF-Connecting-IP'));
		console.log(request.method + ': ' + request.url);
		console.log('Body: ' + (await request.text()));

		try {
			// Validate the request and extract the parameters
			const { cloudflareApiToken, updateHostIp, updateGatewayIp, gatewayUpdateType, record } = validateChangeRequest(request, env);

			if (!updateHostIp && !updateGatewayIp) {
				throw new HttpError(400, 'No update requested!');
			}
			
			const cloudflare = new Cloudflare({apiToken: cloudflareApiToken});

			const tokenStatus = (await cloudflare.user.tokens.verify()).status;
			if (tokenStatus !== 'active') {
				throw new HttpError(401, 'This API Token is ' + tokenStatus);
			}
		
			const zones = (await cloudflare.zones.list()).result;
			if (zones.length > 1) {
				throw new HttpError(400, 'More than one zone was found! You must supply an API Token scoped to a single zone.');
			} else if (zones.length === 0) {
				throw new HttpError(400, 'No zones found! You must supply an API Token scoped to a single zone.');
			}
		
			const zone = zones[0];		

			// Update DNS record
			if (updateHostIp) {
				console.log('Updating DNS record for ' + record.name + '(' + record.type + ') to ' + record.content);
				await updateDNSRecord(cloudflare, zone.id, record);
			}

			// Update Zero Trust Gateway location
			if (updateGatewayIp) {
				const accountId = zone.account?.id;
				if (!accountId) {
					throw new HttpError(400, 'No account ID found for the zone.');
				}
				console.log('Updating Zero Trust Gateway \'' + gatewayUpdateType + '\' location(s) to ' + record.content);
				await updateGatewayLocation(cloudflare, accountId, record, gatewayUpdateType);
			}

			return successResponse();

		} catch (error) {
			if (error instanceof HttpError) {
				console.log('Error updating: ' + error.message);
				return new Response(error.message, { status: error.statusCode });
			} else {
				console.log('Error updating: ' + error);
				return new Response('Internal Server Error', { status: 500 });
			}
		}
	},
} satisfies ExportedHandler<Env>;
