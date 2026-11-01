"""
A fake Foundry runtime, so the @function entry points in
python_functions/translate_functions.py run in tests.

That module imports the Functions API (functions.api) and the generated
Ontology SDK (ontology_sdk) at the top, neither of which exists outside the
Foundry build. load_translate_functions() imports a private copy of it with
small stand-ins for both, then FakeClient replaces FoundryClient:

    tf = load_translate_functions()
    client = FakeClient(units=[...], edges=[...], ...)
    monkeypatch.setattr(tf, "FoundryClient", lambda: client)

The stand-ins cover only what translate_functions uses: property filters
(==, in_, starts_with), where().iterate(), get(), and an edits recorder with
create / edit / delete.
"""

from __future__ import annotations

import importlib.util
import os
import sys
import types
from typing import Any, Callable, Optional

HERE = os.path.dirname(__file__)
ROOT = os.path.abspath(os.path.join(HERE, ".."))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)


# ---------------------------------------------------------------------------
# Objects and property filters
# ---------------------------------------------------------------------------


class FakeObj:
    """An OSDK object: snake_case attributes, None for anything not set."""

    def __init__(self, **props: Any) -> None:
        self.__dict__.update(props)

    def __getattr__(self, name: str) -> Any:
        if name.startswith("__"):
            raise AttributeError(name)
        return None

    def __repr__(self) -> str:
        return f"FakeObj({self.__dict__.get('primary_key_') or self.__dict__.get('identifier')!r})"


class Predicate:
    def __init__(self, test: Callable[[Any], bool], kind: str) -> None:
        self.test = test
        self.kind = kind


class FakeProperty:
    def __init__(self, name: str) -> None:
        self.name = name

    def __eq__(self, value: Any) -> Predicate:  # type: ignore[override]
        return Predicate(lambda o: getattr(o, self.name) == value, "eq")

    def __hash__(self) -> int:
        return hash(self.name)

    def in_(self, values) -> Predicate:
        values = set(values)
        return Predicate(lambda o: getattr(o, self.name) in values, "in")

    def starts_with(self, prefix: str) -> Predicate:
        return Predicate(lambda o: str(getattr(o, self.name) or "").startswith(prefix), "starts_with")


class FakeObjectType:
    def __getattr__(self, name: str) -> FakeProperty:
        if name.startswith("__"):
            raise AttributeError(name)
        return FakeProperty(name)


OBJECT_TYPES = (
    "NxgUnit",
    "NxgUnitHierachyEdge",
    "NxgOperation",
    "NxgUnitHierarchy",
    "NxgVbs4AssetCatalogue",
    "NxgOSwordAssetCatalogue",
    "NxgSimworksAssetCatalogue",
)


# ---------------------------------------------------------------------------
# Client
# ---------------------------------------------------------------------------


class FakeQuery:
    def __init__(self, objs: list) -> None:
        self._objs = objs

    def iterate(self):
        return iter(list(self._objs))


class FakeObjectSet:
    def __init__(self, client: "FakeClient", objs: list) -> None:
        self._client = client
        self._objs = objs

    def get(self, pk: str):
        return next((o for o in self._objs if o.primary_key_ == pk), None)

    def where(self, predicate: Predicate) -> FakeQuery:
        if predicate.kind == "starts_with" and self._client.fail_prefix_search:
            raise RuntimeError("starts_with is not supported on this property")
        return FakeQuery([o for o in self._objs if predicate.test(o)])


class FakeEditSet:
    def __init__(self, recorder: "FakeEdits", type_name: str) -> None:
        self._recorder = recorder
        self._type = type_name

    def create(self, pk: str, **props: Any) -> None:
        self._recorder.log.append(("create", self._type, pk, props))

    def edit(self, obj):
        recorder, type_name = self._recorder, self._type

        class Editable:
            def __setattr__(self, name: str, value: Any) -> None:
                recorder.log.append(("edit", type_name, obj.primary_key_, {name: value}))

        return Editable()

    def delete(self, obj) -> None:
        self._recorder.log.append(("delete", self._type, obj.primary_key_, {}))


class FakeEdits:
    def __init__(self) -> None:
        self.log: list[tuple[str, str, str, dict]] = []
        self.objects = types.SimpleNamespace(**{t: FakeEditSet(self, t) for t in OBJECT_TYPES})

    def get_edits(self) -> list:
        return list(self.log)

    # Convenience for assertions -------------------------------------------

    def of(self, action: str, type_name: str) -> list[tuple[str, dict]]:
        return [(pk, props) for a, t, pk, props in self.log if a == action and t == type_name]

    def edited_props(self, type_name: str, pk: str) -> dict:
        merged: dict = {}
        for a, t, key, props in self.log:
            if a == "edit" and t == type_name and key == pk:
                merged.update(props)
        return merged


class FakeClient:
    """FoundryClient stand-in holding one list of objects per object type."""

    def __init__(self, **objects_by_type: list) -> None:
        self.fail_prefix_search = False
        self.last_edits: Optional[FakeEdits] = None
        store = {t: list(objects_by_type.get(t, [])) for t in OBJECT_TYPES}
        client = self

        class _Ontology:
            objects = types.SimpleNamespace(**{t: FakeObjectSet(client, objs) for t, objs in store.items()})

            @staticmethod
            def edits() -> FakeEdits:
                client.last_edits = FakeEdits()
                return client.last_edits

        self.ontology = _Ontology()


# ---------------------------------------------------------------------------
# Loading translate_functions without Foundry
# ---------------------------------------------------------------------------


def _function(fn=None, **_kwargs):
    """Stand-in for functions.api.function: usable bare or with arguments."""
    if fn is not None and callable(fn):
        return fn
    return lambda f: f


def _stub_modules() -> dict[str, types.ModuleType]:
    functions_pkg = types.ModuleType("functions")
    api = types.ModuleType("functions.api")
    api.function = _function
    api.String = str
    api.OntologyEdit = object
    functions_pkg.api = api

    sdk = types.ModuleType("ontology_sdk")
    def _unpatched_client():
        raise RuntimeError("patch FoundryClient in the test")

    sdk.FoundryClient = _unpatched_client
    sdk_ontology = types.ModuleType("ontology_sdk.ontology")
    sdk_objects = types.ModuleType("ontology_sdk.ontology.objects")
    for name in OBJECT_TYPES:
        setattr(sdk_objects, name, type(name, (), {"object_type": FakeObjectType()}))
    sdk.ontology = sdk_ontology
    sdk_ontology.objects = sdk_objects

    return {
        "functions": functions_pkg,
        "functions.api": api,
        "ontology_sdk": sdk,
        "ontology_sdk.ontology": sdk_ontology,
        "ontology_sdk.ontology.objects": sdk_objects,
    }


def load_translate_functions():
    """
    A private copy of python_functions.translate_functions, imported against
    the stand-ins. sys.modules is restored afterwards, so a real SDK (in the
    build environment) is neither replaced nor used by these tests.
    """
    stubs = _stub_modules()
    saved = {name: sys.modules.get(name) for name in stubs}
    sys.modules.update(stubs)
    try:
        path = os.path.join(ROOT, "python_functions", "translate_functions.py")
        spec = importlib.util.spec_from_file_location("translate_functions_under_test", path)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module
    finally:
        for name, previous in saved.items():
            if previous is None:
                sys.modules.pop(name, None)
            else:
                sys.modules[name] = previous


# ---------------------------------------------------------------------------
# Fixture builders
# ---------------------------------------------------------------------------


def operation(key: str = "OP-TEST") -> FakeObj:
    return FakeObj(primary_key_=key, start_time="2026-09-15", end_time="2026-09-30", terrain_name="testland")


def hierarchy(key: str, phase_key: Optional[str] = None, operation_key: str = "OP-TEST") -> FakeObj:
    return FakeObj(primary_key_=key, name=key, operation_key=operation_key, phase_key=phase_key)


def edge(hierarchy_key: str, parent: str, child: str, key: Optional[str] = None) -> FakeObj:
    return FakeObj(
        primary_key_=key or f"E-{parent}-{child}",
        hierarchy_key=hierarchy_key,
        parent_unit_key=parent,
        child_unit_key=child,
        relationship_type_key="RELTYPE-ORGANIC",
        valid_from="2026-09-15",
        valid_to=None,
    )


def unit(
    key: str,
    entity_type: str = "organisation",
    owning_simulator: str = "vbs4",
    code: Optional[str] = None,
    lat: Optional[float] = 59.4,
    lng: Optional[float] = 24.7,
    dis: str = "1.1.826.1.1.1.0",
    name: Optional[str] = None,
) -> FakeObj:
    return FakeObj(
        primary_key_=key,
        unit_identifier=name or key,
        military_service="Army",
        echelon="",
        sidc="SFGPU----------",
        affiliation="Friend",
        allegiance="GBR",
        latitude=lat,
        longitude=lng,
        entity_type=entity_type,
        owning_simulator=owning_simulator,
        dis=dis,
        can_control_drones=False,
        simulator_identifier_code=code,
    )


def vbs4_asset(identifier: str, dis: str = "1.1.826.1.1.1.0") -> FakeObj:
    return FakeObj(
        identifier=identifier,
        dis6_code=dis,
        dis_code=dis,
        is_drone=False,
        has_commander=True,
        num_cargo_seats=0,
        gunner_seat_names="Gunner",
        gunner_seat_turret_ids="0",
    )


def sword_asset(identifier: str, dis: str = "1.1.826.3.1.0.0") -> FakeObj:
    return FakeObj(identifier=identifier, dis6code=dis, display_name=identifier.split("|")[0])


def simworks_asset(identifier: str) -> FakeObj:
    return FakeObj(identifier=identifier, nxg_canonical_asset=lambda: None)


def walk(entities: list[dict]):
    for node in entities:
        yield node
        yield from walk(node.get("children", []) or [])
