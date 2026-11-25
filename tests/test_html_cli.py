import json
from uuid import uuid4
import httpx
from fastapi.testclient import TestClient
from typer.testing import CliRunner
from opendirector import cli
from opendirector.agent.tools import SYSTEM, INTERACTIVE_HTML_GUIDANCE
from opendirector.infrastructure.local_projects import LocalProjects
from opendirector_api.main import create_app


def test_agent_cli_converts_existing_text_to_interactive_html(tmp_path, monkeypatch):
    monkeypatch.delenv('OPENDIRECTOR_AGENT_SOCKET', raising=False)
    monkeypatch.delenv('OPENDIRECTOR_AGENT_HOST', raising=False)
    api = TestClient(create_app(LocalProjects(tmp_path)), headers={'X-OpenDirector-Request':'1'})
    original = httpx.Client
    def forward(request):
        result = api.request(request.method, request.url.path, headers=dict(request.headers), content=request.read())
        return httpx.Response(result.status_code, headers=result.headers, content=result.content)
    monkeypatch.setattr(cli.httpx, 'Client', lambda **kwargs: original(**kwargs, transport=httpx.MockTransport(forward)))
    runner = CliRunner(); pid = str(uuid4())
    def invoke(args):
        r = runner.invoke(cli.app, ['--project',pid,*args]); assert r.exit_code == 0, r.output
        return json.loads(r.output)
    invoke(['project','create','--name','HTML conversion'])
    source=tmp_path/'choice.html';source.write_text('<button>Choose B</button>')
    invoke(['canvas','text','create','--file',str(source),'--x','20','--y','30','--format','html'])
    item=invoke(['project','show'])['canvasItems'][0]
    assert item['textFormat']=='html'
    invoke(['canvas','text','update','--id',item['id'],'--file',str(source),'--format','markdown',
        '--expected-version',f"canvas_item:{item['id']}:{item['revision']}"])
    assert invoke(['project','show'])['canvasItems'][0].get('textFormat','markdown')=='markdown'
    assert INTERACTIVE_HTML_GUIDANCE in SYSTEM
