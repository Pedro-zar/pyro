/**
 * Descanso do grupo: o mestre pede, cada jogador escolhe o que o personagem
 * faz enquanto descansa, e o descanso recupera como uma cena, mais o que as
 * ações escolhidas dão.
 *
 * O pedido sai da ficha do Grupo como um card por membro, só para quem é dono
 * dele. É do card que o jogador abre as ações (ver DescansoApp), e o
 * personagem guarda a mensagem em que já descansou: o mesmo card não
 * descansa duas vezes.
 */
import { PYRO } from "./config.mjs";
import { esc } from "./ui.mjs";
import { flagsDe, flagsDoSistema, SYSTEM_ID } from "./sistema.mjs";
import { aplicarExaustao, nivelExaustao } from "./efeitos.mjs";
import { registrarUso } from "./progressao.mjs";

const loc = (k, d) => (d ? game.i18n.format(k, d) : game.i18n.localize(k));

/**
 * Qualidades do descanso, da pior para a melhor. `acoes` é quanto cabe de
 * ações no descanso (o normal dá 2, e cada degrau soma ou tira 1).
 * `exaustao` é quanto ele tira sozinho: só o normal ou melhor tira 1 nível.
 */
export const QUALIDADES = {
  pessimo: { label: "PYRO.Descanso.Qualidade.pessimo", acoes: 0, exaustao: 0 },
  ruim: { label: "PYRO.Descanso.Qualidade.ruim", acoes: 1, exaustao: 0 },
  normal: { label: "PYRO.Descanso.Qualidade.normal", acoes: 2, exaustao: 1 },
  confortavel: { label: "PYRO.Descanso.Qualidade.confortavel", acoes: 3, exaustao: 1 },
  luxuoso: { label: "PYRO.Descanso.Qualidade.luxuoso", acoes: 4, exaustao: 1 }
};

/**
 * O que dá para fazer durante o descanso, e quantas ações cada vez custa.
 * Uma ação pode ser feita mais de uma vez: dois Meditar recuperam o dobro,
 * dois Praticar treinam duas perícias. `escolhe` diz o que a ação pede a
 * quem a faz (uma perícia, um recurso), e `quantas` se é uma escolha por vez
 * ("porVez") ou uma só para todas ("uma"). As que ainda não têm mecânica só
 * aparecem no card do descanso.
 */
export const ACOES = {
  meditar: { custo: 1, escolhe: "recurso", quantas: "porVez" },
  praticar: { custo: 1, escolhe: "pericia", quantas: "porVez" },
  aprender: { custo: 1, escolhe: "pericia", quantas: "uma", variavel: true },
  tratar: { custo: 1 },
  repousar: { custo: 2 },
  fabricar: { custo: 1 },
  pesquisar: { custo: 1 },
  preparar: { custo: 1 },
  cuidar: { custo: 1 }
};

/** Quantas ações as escolhas ocupam: { chave: { vezes } }. */
export function acoesGastas(escolhas = {}) {
  return Object.entries(escolhas).reduce((soma, [chave, e]) =>
    soma + (ACOES[chave]?.custo ?? 0) * Math.max(0, Math.floor(Number(e?.vezes) || 0)), 0);
}

/**
 * Os recursos que o personagem pode meditar: os que a ficha dele mostra,
 * menos vida, estamina e vontade. Mana só de quem tem magia, energia só de
 * quem tem feitiçaria e os de raça só de quem tem o caminho que os concede.
 */
export function recursosMeditaveis(actor) {
  const sys = actor?.system ?? {};
  return Object.keys(sys.recursos ?? {}).filter(chave => {
    if (["pv", "estamina", "vontade"].includes(chave)) return false;
    if (chave === "mana") return !!sys.temMagia;
    if (chave === "energia") return !!sys.temFeiticos;
    return (sys.recursosConcedidos ?? []).includes(chave);
  }).map(chave => ({
    id: chave,
    nome: loc(PYRO.recursosCustom?.[chave]?.label ?? `PYRO.Recursos.${chave}`)
  }));
}

/** O que cada ação deixa escolher nesta ficha: [{ id, nome }] por tipo. */
export function opcoesDeEscolha(actor) {
  return {
    recurso: recursosMeditaveis(actor),
    pericia: actor.items.filter(i => i.type === "pericia")
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(i => ({ id: i.id, nome: i.name }))
  };
}

/** "1 ação", "3 ações". */
export const textoDeAcoes = n => (n === 1 ? loc("PYRO.Descanso.UmaAcao") : loc("PYRO.Descanso.NAcoes", { n }));

/** Quem recebe o card de um ator: os donos dele e o mestre. */
function destinatarios(actor) {
  return game.users
    .filter(u => u.isGM || actor.testUserPermission(u, "OWNER"))
    .map(u => u.id);
}

/**
 * Pergunta a qualidade e manda um card de descanso para cada membro. Não
 * recupera ninguém: quem recupera é o jogador, ao escolher as ações.
 */
export async function pedirDescanso(membros) {
  if (!game.user.isGM || !membros.length) return;
  const qualidade = await foundry.applications.api.DialogV2.wait({
    window: { title: loc("PYRO.Descanso.Pedir") },
    content: `<p class="hint">${loc("PYRO.Descanso.PedirDica")}</p>`,
    buttons: Object.entries(QUALIDADES).reverse().map(([chave, q]) => ({
      action: chave, label: loc(q.label)
    })),
    rejectClose: false
  });
  if (!QUALIDADES[qualidade]) return;

  for (const actor of membros) {
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor }),
      whisper: destinatarios(actor),
      content: `<div class="pyro-chat pyro-descanso-card">
        <p><strong>${loc("PYRO.Descanso.Realizado", { qualidade: loc(QUALIDADES[qualidade].label) })}</strong></p>
        <button type="button" class="pyro-escolher-descanso">
          <i class="fa-solid fa-campground"></i> ${loc("PYRO.Descanso.Escolher")}</button>
      </div>`,
      flags: flagsDoSistema({ descanso: { qualidade, atorUuid: actor.uuid } })
    });
  }
}

/** Botão do card: abre as ações para o dono do personagem. */
export function prepararBotaoDescanso(message, element, abrir) {
  const dados = flagsDe(message)?.descanso;
  const botao = element.querySelector(".pyro-escolher-descanso");
  if (!dados || !botao) return;
  const actor = fromUuidSync(dados.atorUuid);
  if (flagsDe(actor)?.descansoFeito === message.id) {
    botao.disabled = true;
    botao.innerHTML = `<i class="fa-solid fa-check"></i> ${loc("PYRO.Descanso.Feito")}`;
    return;
  }
  botao.addEventListener("click", () => {
    if (!actor?.isOwner) return ui.notifications.warn(loc("PYRO.Descanso.SemPermissao"));
    abrir({ actor, qualidade: dados.qualidade, mensagemId: message.id });
  });
}

/**
 * Descansa: a cena passa, a exaustão cai e cada ação escolhida faz o dela,
 * uma vez para cada vez que foi escolhida.
 *
 * @param {Actor} actor
 * @param {object} opts
 * @param {string} opts.qualidade chave de QUALIDADES.
 * @param {string} opts.mensagemId o card de onde o descanso saiu.
 * @param {object} opts.escolhas { meditar: { vezes: 2, alvos: ["mana",
 *   "energiaNatural"] }, praticar: { vezes, alvos: [id, id] }, aprender:
 *   { vezes, alvos: [id] }, repousar: { vezes }, ... }.
 */
export async function descansar(actor, { qualidade, mensagemId, escolhas = {} }) {
  const q = QUALIDADES[qualidade];
  if (!q || !actor?.isOwner) return false;
  if (flagsDe(actor)?.descansoFeito === mensagemId) {
    ui.notifications.warn(loc("PYRO.Descanso.JaDescansou"));
    return false;
  }
  if (acoesGastas(escolhas) > q.acoes) {
    ui.notifications.warn(loc("PYRO.Descanso.AcoesDemais", { max: q.acoes }));
    return false;
  }
  const vezes = chave => Math.max(0, Math.floor(Number(escolhas[chave]?.vezes) || 0));
  // Marca antes de recuperar: um segundo clique no meio das idas ao
  // servidor descansaria duas vezes.
  await actor.setFlag(SYSTEM_ID, "descansoFeito", mensagemId);

  await actor.recuperarCena({ aviso: false });
  const linhas = [];
  const recursos = actor.system.recursos;

  /*
   * --- Meditar: INT a mais, além da cena, no recurso escolhido em cada vez.
   * Duas meditações podem ir para o mesmo recurso ou para dois.
   */
  if (vezes("meditar")) {
    const int = actor.system.atributos.int.total;
    const meditaveis = recursosMeditaveis(actor);
    const ganho = new Map();
    for (let i = 0; i < vezes("meditar"); i++) {
      const alvo = meditaveis.find(r => r.id === escolhas.meditar.alvos?.[i]) ?? meditaveis[0];
      if (alvo) ganho.set(alvo, (ganho.get(alvo) ?? 0) + int);
    }
    const update = {};
    for (const [alvo, valor] of ganho) {
      const rec = recursos[alvo.id];
      update[`system.recursos.${alvo.id}.value`] = Math.min(rec.max, rec.value + valor);
      linhas.push(loc("PYRO.Descanso.Meditou", { valor, recurso: esc(alvo.nome) }));
    }
    if (ganho.size) await actor.update(update);
  }

  /* --- Exaustão: a do descanso e 1 por repouso profundo ----------------- */
  const tiraExaustao = q.exaustao + vezes("repousar");
  if (tiraExaustao > 0) {
    const antes = nivelExaustao(actor);
    const depois = await aplicarExaustao(actor, -tiraExaustao);
    // Quem não tinha exaustão não perde nada, e o card não diz que perdeu.
    if (antes > depois) linhas.push(loc("PYRO.Descanso.Exaustao", { valor: antes - depois }));
  }

  /* --- Praticar: um uso rotineiro em cada perícia escolhida ------------- */
  const praticadas = (escolhas.praticar?.alvos ?? []).slice(0, vezes("praticar"))
    .map(id => actor.items.get(id)).filter(Boolean);
  for (const pericia of praticadas) {
    await registrarUso(pericia, "rotineira");
    linhas.push(loc("PYRO.Descanso.Praticou", { pericia: esc(pericia.name) }));
  }

  /* --- As que ainda não têm mecânica: só ficam registradas -------------- */
  if (vezes("aprender")) {
    const aprendida = actor.items.get(escolhas.aprender?.alvos?.[0]);
    linhas.push(loc("PYRO.Descanso.Aprendeu", {
      pericia: esc(aprendida?.name ?? "—"), acoes: textoDeAcoes(vezes("aprender"))
    }));
  }
  for (const chave of ["fabricar", "pesquisar", "preparar", "cuidar"]) {
    if (vezes(chave)) {
      linhas.push(loc(`PYRO.Descanso.Acao.${chave}`, { acoes: textoDeAcoes(vezes(chave) * ACOES[chave].custo) }));
    }
  }

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `<div class="pyro-chat pyro-descanso-card">
      <p><strong>${loc("PYRO.Descanso.Descansou", {
        nome: esc(actor.name), qualidade: loc(q.label)
      })}</strong></p>
      <p class="pyro-nota">${loc("PYRO.Chat.NovaCena")}</p>
      ${linhas.length ? `<ul>${linhas.map(l => `<li>${l}</li>`).join("")}</ul>` : ""}
    </div>`
  });

  /*
   * Tratar ferimentos cura SAB de quem trata, e pode ser em si ou num
   * companheiro: um card por vez, cada um com a cura, e o botão de curar do
   * rodapé aplica em quem estiver selecionado (ver injetarRodape). Dois
   * tratamentos podem ir para duas pessoas.
   */
  const sab = actor.system.atributos.sab.total;
  for (let i = 0; i < vezes("tratar"); i++) {
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor }),
      content: `<div class="pyro-chat pyro-descanso-card">
        <p>${loc("PYRO.Descanso.Tratou", { nome: esc(actor.name) })}</p>
        <p>${loc("PYRO.Descanso.Cura", { valor: sab })}</p>
      </div>`,
      flags: flagsDoSistema({ cura: sab })
    });
  }
  return true;
}

/** As ações com o rótulo, o custo e o benefício, para a janela. */
export function acoesParaEscolher() {
  return Object.entries(ACOES).map(([chave, a]) => ({
    chave,
    nome: loc(`PYRO.Descanso.Opcao.${chave}.nome`),
    beneficio: loc(`PYRO.Descanso.Opcao.${chave}.beneficio`),
    duracao: a.variavel ? loc("PYRO.Descanso.Variavel") : textoDeAcoes(a.custo),
    custo: a.custo,
    escolhe: a.escolhe ?? null,
    quantas: a.quantas ?? null
  }));
}
