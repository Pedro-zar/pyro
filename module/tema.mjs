import { PYRO } from "./config.mjs";

/**
 * O tema da ficha num lugar só, para a ficha do ator, as fichas dos itens
 * dele, o construtor de efeitos, o conjurador e os diálogos de teste tingirem
 * igual: quem pinta é sempre pintarTema, quem decide a cor é selosDePoder.
 */

/**
 * Selos de poder: um por sistema que o personagem empunha (magia rúnica,
 * feitiçaria, energia natural e técnicas). Clicar num selo escolhe qual
 * deles tinge a ficha, e a escolha fica na flag "tema".
 *
 * O selo do mago aceita ainda uma cor específica entre as afinidades, na
 * flag "temaCor": o mago de gelo e o de fogo não precisam ter a mesma ficha.
 */
export function selosDePoder(actor) {
  const sys = actor.system;
  const loc = k => game.i18n.localize(k);
  const selos = [];
  const elementos = sys.afinidadesElementos ?? [];

  if (sys.temMagia) {
    // Cor escolhida à mão, quando ainda é uma afinidade válida. Senão a
    // primeira afinidade, e por último o acento padrão do sistema.
    const escolhida = actor.getFlag("pyro", "temaCor");
    const elemento = elementos.includes(escolhida)
      ? escolhida
      : (sys.afinidadesLista?.[0]?.cor ?? null);
    selos.push({
      chave: "mago",
      cor: elemento ? `var(--pyro-el-${elemento})` : "var(--pyro-brasa)",
      label: loc("PYRO.Vocacao.mago"),
      temCores: elementos.length > 0
    });
  }
  if (sys.temFeiticos) {
    selos.push({ chave: "feiticeiro", cor: "var(--pyro-sangue)", label: loc("PYRO.Vocacao.feiticeiro") });
  }
  // Vários recursos próprios ainda rendem um selo só: a marca é a mesma.
  if ((sys.recursosConcedidos ?? []).some(c => PYRO.recursosCustom?.[c])) {
    selos.push({ chave: "natural", cor: "var(--pyro-recurso-custom)", label: loc("PYRO.Vocacao.natural") });
  }
  if (sys.temTecnicas) {
    selos.push({ chave: "fisico", cor: "var(--pyro-vontade)", label: loc("PYRO.Vocacao.fisico") });
  }

  const escolhido = actor.getFlag("pyro", "tema");
  const principal = selos.find(s => s.chave === escolhido) ?? selos[0] ?? null;
  for (const selo of selos) {
    selo.ativo = selo === principal;
    selo.dica = game.i18n.format(
      selo.ativo && selo.temCores ? "PYRO.Vocacao.DicaCores" : "PYRO.Vocacao.DicaTema",
      { nome: selo.label }
    );
  }

  const corAtual = actor.getFlag("pyro", "temaCor");
  const coresElemento = principal?.chave === "mago"
    ? elementos.map(chave => ({
        chave,
        label: loc(PYRO.elementos[chave]?.label ?? chave),
        ativo: chave === corAtual,
        dica: game.i18n.format(
          chave === corAtual ? "PYRO.Vocacao.CorAutomatica" : "PYRO.Vocacao.CorElemento",
          { elemento: loc(PYRO.elementos[chave]?.label ?? chave) }
        )
      }))
    : [];

  return { selosPoder: selos, seloPrincipal: principal, coresElemento };
}

const ACENTOS = ["--pyro-acento-ficha", "--pyro-acento-alto", "--pyro-acento-suave"];
const MARCAS = ["mago", "feiticeiro", "natural", "fisico"];

/**
 * Tinge um elemento raiz (janela, ficha, diálogo) com o tema do ator.
 *
 * São três variáveis porque as janelas usam três tons do mesmo acento — o
 * cheio nas barras e botões, o claro nos textos de destaque, o translúcido
 * nos fundos. Os dois derivados saem por color-mix da cor escolhida, então o
 * selo só precisa saber a própria cor. Sem ator ou sem selo as variáveis são
 * apagadas e o CSS volta sozinho para os tons de brasa.
 *
 * `selo` pode vir pronto (a ficha do ator já o calculou para o contexto);
 * omitido, é calculado aqui. `marca` liga as classes de marca d'água, que só
 * a ficha do ator desenha.
 */
export function pintarTema(elemento, actor, { selo, marca = false } = {}) {
  if (!elemento) return null;
  const principal = selo !== undefined
    ? selo
    : (actor ? selosDePoder(actor).seloPrincipal : null);
  const cor = principal?.cor ?? null;
  const estilo = elemento.style;
  if (cor) {
    estilo.setProperty("--pyro-acento-ficha", cor);
    estilo.setProperty("--pyro-acento-alto", `color-mix(in srgb, ${cor} 72%, #fff)`);
    estilo.setProperty("--pyro-acento-suave", `color-mix(in srgb, ${cor} 16%, transparent)`);
  }
  else for (const v of ACENTOS) estilo.removeProperty(v);
  if (marca) {
    for (const chave of MARCAS) elemento.classList.toggle(`marca-${chave}`, principal?.chave === chave);
  }
  return principal;
}

/**
 * Opções de DialogV2 para um diálogo que pertence a um ator: classe do
 * sistema e o tema pintado assim que a janela nasce.
 */
export function dialogoDoAtor(actor) {
  return {
    // "dialog" repetido de propósito: se as classes substituírem as do
    // núcleo em vez de somar, o diálogo não perde o próprio estilo.
    classes: ["dialog", "pyro", "dialogo"],
    render: (event, dialog) => pintarTema(dialog.element, actor)
  };
}
