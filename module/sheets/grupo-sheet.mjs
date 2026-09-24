/**
 * Ficha do Grupo: a party numa tela só. Cada linha é um membro lido na hora
 * (vida, vontade, DET, carga, exaustão, caminhos), e os botões do topo fazem
 * o tempo da mesa: passar turno/minuto/hora/dia desconta os prazos de todo
 * mundo, e nova cena/capítulo recupera todo mundo de uma vez.
 */
import { PYRO } from "../config.mjs";
import { caminho } from "../sistema.mjs";
import { nivelExaustao } from "../efeitos.mjs";
import { passarTempo } from "../tempo.mjs";

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ActorSheetV2 } = foundry.applications.sheets;

const loc = (k, d) => (d ? game.i18n.format(k, d) : game.i18n.localize(k));

/** Quanto tempo cada botão passa, em segundos. */
const TEMPOS = {
  turno: PYRO.SEGUNDOS_POR_TURNO,
  minuto: 60,
  hora: 3600,
  dia: 86400
};

export class PyroGrupoSheet extends HandlebarsApplicationMixin(ActorSheetV2) {
  static DEFAULT_OPTIONS = {
    classes: ["pyro", "actor", "grupo"],
    position: { width: 680, height: 640 },
    window: { resizable: true },
    actions: {
      abrirMembro: PyroGrupoSheet.#abrirMembro,
      removerMembro: PyroGrupoSheet.#removerMembro,
      passarTempo: PyroGrupoSheet.#passarTempo,
      recuperar: PyroGrupoSheet.#recuperar
    }
  };

  static PARTS = {
    corpo: { template: caminho("templates/actor/grupo.hbs") }
  };

  /** Os membros como atores, na ordem guardada, ignorando o que sumiu. */
  #membros() {
    return (this.actor.system.membros ?? [])
      .map(uuid => fromUuidSync(uuid))
      .filter(a => a instanceof Actor);
  }

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const membros = [];
    for (const membro of this.#membros()) {
      const sys = membro.system;
      const pv = sys.recursos?.pv ?? { value: 0, max: 0 };
      const vontade = sys.recursos?.vontade ?? { value: 0, max: 0 };
      /*
       * As mesmas regras de visibilidade da ficha do personagem: estamina é
       * de todos, mana só de mago, energia só de feiticeiro, e os recursos de
       * raça só de quem tem o caminho que os concede. PV e vontade ficam de
       * fora — o PV já é a barra principal e a vontade é número, não barra.
       */
      const barras = [];
      for (const [chave, rec] of Object.entries(sys.recursos ?? {})) {
        if (["pv", "vontade"].includes(chave)) continue;
        const custom = PYRO.recursosCustom?.[chave];
        if (chave === "mana" && !sys.temMagia) continue;
        if (chave === "energia" && !sys.temFeiticos) continue;
        if (custom && !(sys.recursosConcedidos ?? []).includes(chave)) continue;
        barras.push({
          chave: custom ? "custom" : chave,
          label: loc(custom?.label ?? `PYRO.Recursos.${chave}`),
          value: rec.value,
          max: rec.max,
          pct: rec.max > 0 ? Math.clamp(Math.round((rec.value / rec.max) * 100), 0, 100) : 0
        });
      }
      membros.push({
        barras,
        // Só o valor bruto de cada atributo; os dados ficam para a ficha.
        atributos: Object.entries(PYRO.atributos).map(([chave, label]) => ({
          label: loc(label), total: sys.atributos?.[chave]?.total ?? 0
        })),
        uuid: membro.uuid,
        nome: membro.name,
        img: membro.img,
        pv,
        pvPct: pv.max > 0 ? Math.clamp(Math.round((pv.value / pv.max) * 100), 0, 100) : 0,
        vontade,
        det: sys.det ?? 0,
        carga: sys.carga ?? { atual: 0, max: 0 },
        sobrepeso: !!sys.sobrepeso,
        exaustao: nivelExaustao(membro),
        caminhos: membro.items.filter(i => i.type === "caminho")
          .map(i => i.name).join(", ")
      });
    }
    return Object.assign(context, {
      membros,
      ehGM: game.user.isGM,
      editavel: this.isEditable,
      // Botões montados aqui para o template não conhecer a tabela de tempos.
      temposDoGrupo: Object.keys(TEMPOS).map(chave => ({
        chave, label: loc(`PYRO.Grupo.Tempo.${chave}`)
      }))
    });
  }

  /* ---------------------------------------------------------------------- */

  /**
   * Arrastar um personagem ou NPC para a ficha o torna membro. O ator
   * sintético de token não entra: o grupo é da campanha, não de uma cena.
   */
  async _onDropActor(event, dado) {
    // Conforme a versão, chega o próprio ator ou o dado de arrasto com uuid.
    const actor = dado instanceof Actor ? dado : await fromUuid(dado?.uuid ?? "");
    if (!this.actor.isOwner) return;
    if (!["personagem", "npc"].includes(actor?.type)) return;
    if (actor.isToken) {
      return ui.notifications.warn(loc("PYRO.Grupo.SoAtorDeMundo"));
    }
    const membros = this.actor.system.membros ?? [];
    if (membros.includes(actor.uuid)) return;
    return this.actor.update({ "system.membros": [...membros, actor.uuid] });
  }

  static #abrirMembro(event, target) {
    const membro = fromUuidSync(target.closest("[data-uuid]")?.dataset.uuid ?? "");
    membro?.sheet?.render(true);
  }

  static async #removerMembro(event, target) {
    const uuid = target.closest("[data-uuid]")?.dataset.uuid;
    const membros = (this.actor.system.membros ?? []).filter(m => m !== uuid);
    return this.actor.update({ "system.membros": membros });
  }

  /**
   * Só o mestre passa tempo e recupera: os dois mexem em todas as fichas (e o
   * relógio do mundo é dele), então nos outros clientes os botões nem saem no
   * template — isto aqui é a trava de verdade, não a de aparência.
   */
  static async #passarTempo(event, target) {
    if (!game.user.isGM) return;
    const chave = target.dataset.tempo;
    const segundos = TEMPOS[chave];
    if (!segundos) return;
    return passarTempo(this.#membros(), segundos, loc(`PYRO.Grupo.Passou.${chave}`));
  }

  static async #recuperar(event, target) {
    if (!game.user.isGM) return;
    const metodo = {
      cena: "recuperarCena",
      capitulo: "recuperarCapitulo"
    }[target.dataset.tipo];
    if (!metodo) return;
    for (const membro of this.#membros()) {
      if (membro.isOwner) await membro[metodo]();
    }
  }
}

/* -------------------------------------------------------------------------- */
/*
 * A ficha do Grupo mostra dados que moram nos MEMBROS, então mudar um membro
 * não re-renderiza nada sozinho — o Foundry só redesenha a ficha do documento
 * que mudou. Estes ganchos cobrem o resto: mudou um ator, um item ou um
 * efeito de alguém que está num grupo aberto, o grupo redesenha. Com
 * debounce, porque uma recuperação de cena dispara vários updates em fila.
 */
// Redesenha todas de uma vez: com debounce por membro, dois membros mudando
// na mesma leva fariam o primeiro uuid ser engolido pelo segundo.
const redesenharGrupos = foundry.utils.debounce(() => {
  for (const app of foundry.applications.instances.values()) {
    if (app instanceof PyroGrupoSheet && app.rendered) app.render();
  }
}, 100);

const membroMudou = actor => {
  if (!(actor instanceof Actor) || actor.type === "grupo") return;
  for (const app of foundry.applications.instances.values()) {
    if (app instanceof PyroGrupoSheet && app.rendered
      && app.actor?.system?.membros?.includes(actor.uuid)) return redesenharGrupos();
  }
};
/** O ator dono de um item, ou de um efeito (que pode estar num item). */
const atorDoDocumento = doc =>
  (doc?.parent instanceof Actor ? doc.parent : doc?.parent?.parent);

Hooks.on("updateActor", membroMudou);
for (const gancho of ["createItem", "updateItem", "deleteItem",
  "createActiveEffect", "updateActiveEffect", "deleteActiveEffect"]) {
  Hooks.on(gancho, doc => membroMudou(atorDoDocumento(doc)));
}
