from uuid import UUID, uuid4
import asyncio
import pytest
from opendirector.domain.creation.commands import parse_command
from opendirector.domain.creation.generation import TextParameters
from opendirector.application.creation_canvas import asset_ref
from test_creation_canvas_service import project, text_material, media, send, ver
from test_creation_generation_service import Provider, runtime

@pytest.fixture
def anyio_backend(): return 'asyncio'

@pytest.mark.anyio
@pytest.mark.parametrize('edit_during_run',[False,True])
async def test_modify_freezes_original_and_preserves_concurrent_edits(project,edit_during_run):
    store,pid,session=project; provider=Provider(); runner,config=runtime(project,provider)
    source,asset=text_material(project)
    target,spec=media(project)
    assert send(store,pid,'canvas.materialize',session=session,versions=[ver('canvas_item',target)],itemId=target.id,asset=asset_ref(asset)).status=='applied'
    changed=spec.model_copy(update={'modelConfigId':UUID(config['id']),'prompt':'Change only the second shot','parameters':TextParameters(operation='modify',sourceAsset=asset_ref(asset))})
    assert send(store,pid,'generationSpec.update',session=session,versions=[ver('generation_spec',spec)],spec=changed).status=='applied'
    target=next(x for x in store.snapshot(pid).canvasItems if x.id==target.id)
    assert send(store,pid,'canvas.configure',session=session,versions=[ver('canvas_item',target),ver('generation_spec',store.snapshot(pid).generationSpecs[-1])],itemId=target.id,specId=spec.id,preserveMaterial=True).status=='applied'
    state=store.snapshot(pid);target=next(x for x in state.canvasItems if x.id==target.id);spec=state.generationSpecs[-1]
    command=parse_command(dict(commandId=uuid4(),projectId=pid,type='generation.submit',expectedVersions=[ver('canvas_item',target),ver('generation_spec',spec)],payload=dict(specId=spec.id,expectedSpecRevision=spec.revision,originItemId=target.id)))
    try:
        assert (await runner.execute(command,session=session)).status=='accepted'
        await provider.started.wait()
        job=store.snapshot(pid).jobs[-1]
        assert job.inputSnapshot.spec.prompt=='Change only the second shot'
        assert any(ref.asset.assetId==asset.id for ref in job.inputSnapshot.references)
        assert any(part.get('assetId')==str(asset.id) for part in provider.calls[-1]['promptContent'])
        if edit_during_run:
            assert send(store,pid,'asset.writeText',session=session,name='later.md',text='Later user edit').status=='applied'
            newer=store.snapshot(pid).assets[-1];target=next(x for x in store.snapshot(pid).canvasItems if x.id==target.id)
            assert send(store,pid,'canvas.materialize',session=session,versions=[ver('canvas_item',target)],itemId=target.id,asset=asset_ref(newer),discardGenerationDraft=True).status=='applied'
        provider.finish.set()
        await asyncio.gather(*(job.future for job in list(runner.jobs.values())))
        assert store.snapshot(pid).jobs[-1].adopted is (not edit_during_run)
    finally:
        provider.finish.set();await runner.close()

def test_text_operation_rejects_missing_source_and_implicit_regenerate_source():
    from pydantic import ValidationError
    with pytest.raises(ValidationError): TextParameters(operation='modify')
    with pytest.raises(ValidationError): TextParameters(operation='regenerate',sourceAsset={'assetId':str(uuid4()),'revision':1,'kind':'text','fingerprint':'sha256:'+'a'*64})
