"""Versioned transport and tensor contract. The TS handshake must match exactly."""
PROTOCOL_VERSION = 1
OBSERVATION_SIZES = {'runner': 316, 'hunter': 313}
ACTION_SIZE = 18


def validate_contract(contract, protocol='selfplay'):
    pursuit = protocol == 'hunter-pursuit-v2'
    expected = {'protocolVersion': 1, 'observationSchemaVersion': 2 if pursuit else 1,
                'actionSchemaVersion': 1, 'runnerObservationSize': 316,
                'hunterObservationSize': 325 if pursuit else 313, 'actionSize': 18}
    if any(contract.get(key) != value for key, value in expected.items()):
        raise ValueError(f'incompatible TS training contract: {contract}')
    moves = [(0, 0), (1, 0), (1, 1), (0, 1), (-1, 1), (-1, 0), (-1, -1), (0, -1), (1, -1)]
    actions = [{'move': {'x': x, 'y': y}, 'useSkill': skill}
               for skill in (False, True) for x, y in moves]
    if contract.get('actions') != actions:
        raise ValueError('incompatible TS action contract')
