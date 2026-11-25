"""HTML settings use shared commits, locks, CAS and durable project history."""
from uuid import uuid4
import pytest
from pydantic import ValidationError
from test_creation_canvas_service import project, send, text_material, ver, media
from opendirector.domain.creation.commands import parse_command
from opendirector.application.creation_history import CreationHistory
from opendirector.infrastructure.creation_projects import CreationProjects
from opendirector.infrastructure.local_projects import LocalProjects


def test_html_state_survives_reload_and_undo_and_checks_versions(project):
    store, pid, session = project
    node, asset = text_material(project)
    command = parse_command(dict(commandId=uuid4(), projectId=pid, type='canvas.configureText',
        expectedVersions=[ver('canvas_item', node)],
        payload=dict(itemId=node.id, textFormat='html', htmlState={'choice': 'b', 'values': [1, True, None]})))
    result = store.execute(command, session=session)
    assert result.status == 'applied', result
    assert store.execute(command, session=session).status == 'applied'
    saved = store.snapshot(pid).canvasItems[0]
    assert saved.binding.objectRef.assetId == asset.id
    reloaded = CreationProjects(LocalProjects(store.local.repository)).snapshot(pid).canvasItems[0]
    assert reloaded.textFormat == 'html' and reloaded.htmlState['choice'] == 'b'
    rejected = send(store, pid, 'canvas.configureText', session=session, versions=[ver('canvas_item', node)],
        itemId=node.id, textFormat='html', htmlState={'choice': 'c'})
    assert rejected.status == 'rejected'
    assert rejected.issues[0].code == 'revision_conflict'
    undo = send(store, pid, 'history.undo', session=session,
        versions=[ver('canvas_item', saved)], targetCommandId=command.commandId)
    assert undo.status == 'applied', undo
    assert store.snapshot(pid).canvasItems[0].textFormat == 'markdown'


def test_html_configuration_rejects_locked_nodes_nontext_and_oversized_state(project):
    store, pid, session = project
    node, _ = text_material(project)
    assert send(store, pid, 'canvas.update', session=session, versions=[ver('canvas_item', node)],
        itemId=node.id, locked=True).status == 'applied'
    locked = store.snapshot(pid).canvasItems[0]
    result = send(store, pid, 'canvas.configureText', session=session, versions=[ver('canvas_item', locked)],
        itemId=node.id, textFormat='html', htmlState={})
    assert result.status == 'rejected'
    other, _ = media(project, kind='image')
    result = send(store, pid, 'canvas.configureText', session=session, versions=[ver('canvas_item', other)],
        itemId=other.id, textFormat='html', htmlState={})
    assert result.status == 'rejected'
    with pytest.raises(ValidationError):
        parse_command(dict(commandId=uuid4(), projectId=pid, type='canvas.configureText',
            expectedVersions=[ver('canvas_item', node)],
            payload=dict(itemId=node.id, textFormat='html', htmlState={'value': '中' * 23000})))


def test_html_generation_supplies_bridge_contract_without_changing_user_prompt(monkeypatch):
    import asyncio
    import opendirector.integrations.volcengine as module
    captured = {}
    monkeypatch.setattr(module, 'generation_references', lambda *args: {'content': 'Create an interactive chart'})
    def payload(config, messages, thinking):
        captured['messages'] = messages
        return {'messages': messages}
    monkeypatch.setattr(module, 'chat_payload', payload)
    async def stream(self, config, request):
        yield {'type': 'delta', 'text': '<!doctype html><h1>Chart</h1>'}
    monkeypatch.setattr(module.ChatCompletions, 'stream', stream)
    suffix, content = asyncio.run(module.VolcengineGeneration(None)._text({}, {
        'parameters': {'thinking': 'auto', 'max_tokens': 8192, 'output_format': 'html'}}))
    assert content.decode() == '<!doctype html><h1>Chart</h1>'
    assert suffix == 'md'  # Keep HTML source in immutable text assets, never executable asset responses.
    assert 'opendirector.request' in captured['messages'][0]['content']
    assert captured['messages'][1]['content'] == 'Create an interactive chart'
