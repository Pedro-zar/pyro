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
 * dois Praticar treinam duas perícias. `pericias` diz se ela pede uma
 * perícia por vez ("porVez") ou uma só para todas ("uma"). As que ainda não
 * têm mecânica só aparecem no card do descanso.
 */
export const ACOES = {
  meditar: { custo: 1 },
  praticar: { custo: 1, pericias: "porVez" },
  aprender: { custo: 1, pericias: "uma", variavel: true },
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
 * @param {object} opts.escolhas { meditar: { vezes: 2 }, praticar: { vezes,
 *   pericias: [id, id] }, aprender: { vezes, pericias: [id] }, ... }.
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

  /* --- Meditar: INT a mais de mana e energia por vez, além da cena ------ */
  if (vezes("meditar")) {
    const valor = actor.system.atributos.int.total * vezes("meditar");
    const update = {};
    for (const chave of ["mana", "energia"]) {
      const rec = recursos[chave];
      if (rec?.max > 0) update[`system.recursos.${chave}.value`] = Math.min(rec.max, rec.value + valor);
    }
    if (Object.keys(update).length) await actor.update(update);
    linhas.push(loc("PYRO.Descanso.Meditou", { valor }));
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
  const praticadas = (escolhas.praticar?.pericias ?? []).slice(0, vezes("praticar"))
    .map(id => actor.items.get(id)).filter(Boolean);
  for (const pericia of praticadas) {
    await registrarUso(pericia, "rotineira");
    linhas.push(loc("PYRO.Descanso.Praticou", { pericia: esc(pericia.name) }));
  }

  /* --- As que ainda não têm mecânica: só ficam registradas -------------- */
  if (vezes("aprender")) {
    const aprendida = actor.items.get(escolhas.aprender?.pericias?.[0]);
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
    pericias: a.pericias ?? null
  }));
}
