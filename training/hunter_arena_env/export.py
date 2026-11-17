import json
from pathlib import Path
import numpy as np
import torch
from torch import nn


def policy_logits(model, observations):
    with torch.no_grad():
        tensor = torch.as_tensor(observations, dtype=torch.float32, device=model.device)
        features = model.policy.extract_features(tensor)
        latent = model.policy.mlp_extractor.forward_actor(features)
        return model.policy.action_net(latent).cpu().numpy()


def export_policy(model, path, metadata):
    """Export the actor (not critic) in browser output-major PolicyModelV1 format."""
    if not isinstance(model.policy.features_extractor, nn.Flatten) and model.policy.features_extractor.__class__.__name__ != 'FlattenExtractor':
        raise ValueError('only flat observation MLP policies can be exported')
    layers = []
    for module in [*model.policy.mlp_extractor.policy_net, model.policy.action_net]:
        if isinstance(module, nn.Linear):
            layers.append({'weights': module.weight.detach().cpu().tolist(),
                           'biases': module.bias.detach().cpu().tolist(), 'activation': 'linear'})
        elif isinstance(module, (nn.Tanh, nn.ReLU)) and layers:
            layers[-1]['activation'] = 'tanh' if isinstance(module, nn.Tanh) else 'relu'
        else:
            raise ValueError(f'unsupported policy module {type(module).__name__}')
    size = model.observation_space.shape[0]
    result = {'schemaVersion': 1, 'modelVersion': metadata['modelVersion'],
              'observationSize': int(size), 'actionSize': int(model.action_space.n),
              'normalization': {'mean': [0.] * size, 'std': [1.] * size},
              'layers': layers, 'metadata': {**metadata, 'observationSchemaVersion': metadata.get('observationSchemaVersion', 1), 'actionSchemaVersion': 1}}
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(result, allow_nan=False, separators=(',', ':')) + '\n', encoding='utf-8')
    return result


def verify_export(model, path, observations, bridge):
    """Use the actual browser runPolicy function; persist reproducible numerical evidence."""
    path = Path(path)
    observations = np.asarray(observations, dtype=np.float32)
    expected = policy_logits(model, observations)
    actual = np.asarray(bridge.request({'op': 'logits', 'model': json.loads(path.read_text()),
                                       'observations': observations.tolist()}))
    error = float(np.max(np.abs(expected - actual)))
    if not np.isfinite(error) or error >= 1e-5:
        raise AssertionError(f'PyTorch/TypeScript logit parity failed: {error}')
    fixture = {'schemaVersion': 1, 'observations': observations.tolist(),
               'pytorchLogits': expected.tolist(), 'typescriptLogits': actual.tolist(),
               'maxAbsoluteError': error, 'tolerance': 1e-5}
    path.with_suffix('.parity.json').write_text(json.dumps(fixture, separators=(',', ':')) + '\n', encoding='utf-8')
    return {'count': len(observations), 'maxAbsoluteError': error, 'tolerance': 1e-5}
