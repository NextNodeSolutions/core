import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ACCOUNT_ID = '32a2e0c04fde55e1fce3992054d70c8b'
ZONE_ID = 'f8f3403a30894b43455b9f3f0bca6757'
HOSTNAME = 'dev.nextnode.fr'
PAGES_PROJECT = 'nextnode-landing-dev'
EXPECTED_RECORD_ID = '13dbcb1ffb01f27be7022df65f200111'
EXPECTED_RECORD_TARGET = PAGES_PROJECT + '.pages.dev'
SNAPSHOT = Path('landing-dev-cutover-before.json')
CUTOVER_STARTED = Path('landing-dev-cutover-started')
API_ORIGIN = 'https://api.cloudflare.com/client/v4'
REQUEST_TIMEOUT_SECONDS = 30
PAGES_PATH = f'/accounts/{ACCOUNT_ID}/pages/projects/{PAGES_PROJECT}/domains'
DNS_PATH = f'/zones/{ZONE_ID}/dns_records'
WORKER_DOMAINS_PATH = f'/accounts/{ACCOUNT_ID}/workers/domains'


def request(method, path, payload=None):
    token = os.environ['CLOUDFLARE_API_TOKEN']
    if not token or any(character.isspace() for character in token):
        raise RuntimeError('Expected one nonempty Cloudflare token without whitespace')
    headers = {'Authorization': 'Bearer ' + token}
    body = None
    if payload is not None:
        headers['Content-Type'] = 'application/json'
        body = json.dumps(payload).encode()
    api_request = urllib.request.Request(
        API_ORIGIN + path, headers=headers, data=body, method=method,
    )
    try:
        with urllib.request.urlopen(api_request, timeout=REQUEST_TIMEOUT_SECONDS) as response:
            result = json.load(response)
    except urllib.error.HTTPError as error:
        raise RuntimeError(f'Cloudflare {method} {path} returned HTTP {error.code}') from None
    except urllib.error.URLError:
        raise RuntimeError(f'Cloudflare {method} {path} could not connect') from None
    if not result.get('success'):
        raise RuntimeError(f'Cloudflare {method} {path} failed: {result.get("errors")}')
    return result['result']


def dns_records(hostname):
    return request('GET', DNS_PATH + '?' + urllib.parse.urlencode({'name': hostname}))


def worker_domains():
    query = urllib.parse.urlencode({'hostname': HOSTNAME})
    return request('GET', WORKER_DOMAINS_PATH + '?' + query)


def pages_domains():
    return request('GET', PAGES_PATH)


def require_original_record(records):
    expected = {
        'id': EXPECTED_RECORD_ID,
        'name': HOSTNAME,
        'type': 'CNAME',
        'content': EXPECTED_RECORD_TARGET,
        'proxied': False,
        'ttl': 300,
    }
    if len(records) != 1 or any(records[0].get(key) != value for key, value in expected.items()):
        raise RuntimeError('Dev DNS differs from inspected Pages CNAME; refusing changes')


def capture():
    records = dns_records(HOSTNAME)
    require_original_record(records)
    domains = pages_domains()
    matching = [domain for domain in domains if domain['name'] == HOSTNAME]
    if len(matching) != 1 or matching[0]['status'] != 'active':
        raise RuntimeError('Expected the active dev Pages custom domain; refusing changes')
    if worker_domains():
        raise RuntimeError('Dev hostname already has a Worker domain; refusing changes')
    snapshot = {
        'dns': records,
        'pagesDomains': domains,
        'productionDns': dns_records('nextnode.fr'),
    }
    SNAPSHOT.write_text(json.dumps(snapshot, indent=2))
    print(f'Saved DNS and Pages domain snapshot to {SNAPSHOT}')


def verify_production(snapshot):
    if dns_records('nextnode.fr') != snapshot['productionDns']:
        raise RuntimeError('Production DNS changed during cutover; inspect before continuing')


def cutover():
    snapshot = json.loads(SNAPSHOT.read_text())
    records = dns_records(HOSTNAME)
    require_original_record(records)
    if records != snapshot['dns'] or pages_domains() != snapshot['pagesDomains']:
        raise RuntimeError('Dev DNS or Pages domain changed since snapshot; refusing changes')
    if worker_domains():
        raise RuntimeError('Dev hostname already has a Worker domain; refusing changes')
    verify_production(snapshot)
    CUTOVER_STARTED.touch()
    request('DELETE', PAGES_PATH + '/' + HOSTNAME)
    print(f'Detached {HOSTNAME} from Pages project {PAGES_PROJECT}', flush=True)
    records = dns_records(HOSTNAME)
    if records:
        require_original_record(records)
        request('DELETE', DNS_PATH + '/' + EXPECTED_RECORD_ID)
        print('Deleted only the inspected dev Pages CNAME', flush=True)
    if dns_records(HOSTNAME) or any(domain['name'] == HOSTNAME for domain in pages_domains()):
        raise RuntimeError('Dev Pages domain or DNS remains; inspect before deployment')
    verify_production(snapshot)
    print('Dev hostname released; production DNS unchanged; Pages project retained')


def restore():
    snapshot = json.loads(SNAPSHOT.read_text())
    require_original_record(snapshot['dns'])
    if worker_domains():
        raise RuntimeError('A Worker now owns dev; refusing to overwrite its routing')
    verify_production(snapshot)
    records = dns_records(HOSTNAME)
    original = snapshot['dns'][0]
    if records and any(record['type'] != 'CNAME' or record['content'] != EXPECTED_RECORD_TARGET for record in records):
        raise RuntimeError('Unexpected dev DNS exists; refusing rollback overwrite')
    if not records:
        fields = ['name', 'type', 'content', 'proxied', 'ttl', 'settings', 'tags', 'comment']
        request('POST', DNS_PATH, {key: original[key] for key in fields if original.get(key) is not None})
    if not any(domain['name'] == HOSTNAME for domain in pages_domains()):
        request('POST', PAGES_PATH, {'name': HOSTNAME})
    verify_production(snapshot)
    print('Restored the original dev Pages CNAME and custom domain registration')


def recover():
    if CUTOVER_STARTED.exists():
        restore()


def main():
    if os.environ.get('GITHUB_ACTIONS') != 'true':
        raise RuntimeError('This cutover is allowed only in GitHub Actions')
    if os.environ['CLOUDFLARE_ACCOUNT_ID'] != ACCOUNT_ID:
        raise RuntimeError('Cloudflare account differs from the inspected account')
    operations = {'capture': capture, 'cutover': cutover, 'restore': restore, 'recover': recover}
    operation = operations.get(sys.argv[1])
    if operation is None:
        raise RuntimeError('Expected capture, cutover, restore or recover')
    operation()


if __name__ == '__main__':
    try:
        main()
    except RuntimeError as error:
        raise SystemExit(str(error)) from None
