"""Build a command safe for Azure's single-quoted Oryx eval wrapper."""
import json


def startup_command(source):
    source = source.strip()
    # Azure wraps the complete command in single quotes before eval; the
    # generated startup shell then parses the double-quoted JS argument.
    if any(character in source for character in ("'", '$', '`', '\n', '\r')):
        raise ValueError('Probe source contains unsupported shell metacharacters')
    command = 'node --input-type=module -e ' + json.dumps(source)
    if len(command) > 1024:
        raise ValueError('Diagnostic startup command exceeds the Azure limit')
    return command
