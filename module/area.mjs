/**
 * Área de magias e técnicas: a "régua" que a ficha desenha e que o card põe
 * no mapa como uma região do tamanho certo.
 *
 * A área é uma lista de formas (círculo, cone, linha), cada uma com as
 * medidas escritas como fórmula e a posição dela em relação a um ponto de
 * origem. As fórmulas leem as variáveis da conjuração ou da execução, e cada
 * forma lê a sua: numa magia de Cone e Linha, "@runas.linha.comprimento" só
 * cresce com a Intenção posta na Linha, e o cone fica como estava. É assim
 * também que o Amplo entra, escrito na medida que ele alarga.
 *
 * A área também tem duração: a região posta no mapa some quando o relógio
 * desconta o prazo dela, e 1 turno (o padrão) é a área instantânea.
 *
 * As medidas são em metros e os ângulos em graus, no sentido do relógio a
 * partir do leste, com o y para baixo: o mesmo sentido do mapa do Foundry.
 */
import { PYRO } from "./config.mjs";
import { prepararFormula } from "./dados.mjs";
import { avaliarConta } from "./regras-efeito.mjs";
import { esc } from "./ui.mjs";
import { SYSTEM_ID } from "./sistema.mjs";

const loc = (k, d) => (d ? game.i18n.format(k, d) : game.i18n.localize(k));

/**
 * Os tipos de forma e as medidas de cada um, na ordem dos campos da ficha.
 * `unidade` é o que a medida conta (metros ou graus).
 */
export const TIPOS_DE_FORMA = {
  circulo: { label: "PYRO.Area.Tipo.circulo", medidas: [{ campo: "raio", unidade: "m" }] },
  cone: {
    label: "PYRO.Area.Tipo.cone",
    medidas: [{ campo: "comprimento", unidade: "m" }, { campo: "angulo", unidade: "°" }]
  },
  /*
   * A linha pode ser dividida: o comprimento é repartido em partes iguais, e
   * na hora de posicionar cada parte depois da primeira sai do fim da
   * anterior, na direção que o jogador escolher.
   */
  linha: {
    label: "PYRO.Area.Tipo.linha",
    medidas: [
      { campo: "comprimento", unidade: "m" }, { campo: "largura", unidade: "m" },
      { campo: "divisoes", unidade: "", inteiro: true }
    ]
  }
};

/** Medidas de uma forma nova, antes de alguém escrever as dela. */
export const MEDIDAS_PADRAO = { raio: "1", comprimento: "6", largura: "1", angulo: "60", divisoes: "1" };

/** A forma que o botão de mais acrescenta. */
export const formaNova = (tipo = "circulo") => ({
  tipo, ...MEDIDAS_PADRAO, x: 0, y: 0, rotacao: 0
});

/**
 * O número de uma medida. A fórmula aceita os atalhos das fichas ([NVL],
 * @nvl5) e as funções de conta; variável que a conjuração não publicou
 * vale 0, e o que sobra é devolvido para a ficha avisar.
 *
 * @returns {{valor: number, faltando: string[]}}
 */
export function calcularMedida(texto, vars = {}) {
  const escrito = String(texto ?? "").trim();
  if (!escrito) return { valor: 0, faltando: [] };
  const preparado = prepararFormula(escrito, vars);
  const faltando = [];
  const trocado = preparado.replace(/@([a-z_][\w.]*)/gi, (inteiro, nome) => {
    const valor = foundry.utils.getProperty(vars, nome);
    if (typeof valor === "number" && Number.isFinite(valor)) return String(valor);
    faltando.push(nome);
    return "0";
  });
  const valor = avaliarConta(trocado);
  return { valor: Number.isFinite(valor) ? Math.max(0, valor) : 0, faltando };
}

/**
 * As formas com as medidas já em número. As variáveis que faltaram vêm
 * junto, por forma, para a ficha dizer qual medida leu 0 por não achar nada.
 */
export function resolverArea(area, vars = {}) {
  return (area?.formas ?? [])
    .filter(f => TIPOS_DE_FORMA[f?.tipo])
    .map(f => {
      const faltando = new Set();
      const medidas = {};
      for (const { campo, inteiro } of TIPOS_DE_FORMA[f.tipo].medidas) {
        const conta = calcularMedida(f[campo] ?? MEDIDAS_PADRAO[campo], vars);
        // Contagem (as divisões da linha) é inteira e começa em 1.
        medidas[campo] = inteiro ? Math.max(1, Math.floor(conta.valor)) : conta.valor;
        conta.faltando.forEach(n => faltando.add(n));
      }
      return {
        tipo: f.tipo, ...medidas,
        x: Number(f.x) || 0, y: Number(f.y) || 0, rotacao: Number(f.rotacao) || 0,
        faltando: [...faltando]
      };
    });
}

/** Número com vírgula e no máximo uma casa, como a mesa escreve metros. */
const metros = n => Number(n).toLocaleString("pt-BR", { maximumFractionDigits: 1 });

/** "Cone 7 m, 60°" · "Linha 10 × 1 m" · "Círculo raio 2 m". */
export function textoDaForma(f) {
  const nome = loc(TIPOS_DE_FORMA[f.tipo]?.label ?? f.tipo);
  if (f.tipo === "cone") return loc("PYRO.Area.Texto.cone", { nome, comprimento: metros(f.comprimento), angulo: metros(f.angulo) });
  if (f.tipo === "linha") {
    const texto = loc("PYRO.Area.Texto.linha", { nome, comprimento: metros(f.comprimento), largura: metros(f.largura) });
    return (f.divisoes ?? 1) > 1 ? loc("PYRO.Area.Texto.emPartes", { texto, partes: f.divisoes }) : texto;
  }
  return loc("PYRO.Area.Texto.circulo", { nome, raio: metros(f.raio) });
}

/* -------------------------------------------------------------------------- */
/*  Geometria                                                                  */
/* -------------------------------------------------------------------------- */

const rad = graus => (graus * Math.PI) / 180;

/** Gira um ponto em torno da origem, no sentido do relógio do mapa. */
export function girar({ x, y }, graus) {
  const a = rad(graus);
  return { x: x * Math.cos(a) - y * Math.sin(a), y: x * Math.sin(a) + y * Math.cos(a) };
}

/**
 * Uma forma no lugar em que ela cai: a origem da área em `origem`, a área
 * inteira girada `giro` graus. A posição da forma gira junto, para o
 * desenho da ficha continuar o mesmo, só virado.
 *
 * @param {object} forma uma forma resolvida (medidas em metros).
 * @param {{x: number, y: number}} origem onde fica a origem da área.
 * @param {number} giro quanto a área inteira girou, em graus.
 * @param {number} escala quantas unidades de desenho valem um metro.
 */
export function formaNoLugar(forma, origem, giro = 0, escala = 1) {
  const deslocado = girar({ x: forma.x * escala, y: forma.y * escala }, giro);
  return {
    ...forma,
    px: origem.x + deslocado.x,
    py: origem.y + deslocado.y,
    direcao: forma.rotacao + giro,
    escala
  };
}

/**
 * A forma como região do Foundry v14, em pixels. O cone parte da ponta, a
 * linha parte da ponta de trás e cresce para a frente, e o círculo é o
 * centro. Nada é preso ao grid: a medida é a que a conta deu.
 */
export function formaDaRegiao(forma, origem, giro, pxPorMetro) {
  const f = formaNoLugar(forma, origem, giro, pxPorMetro);
  if (f.tipo === "cone") {
    return {
      type: "cone", x: f.px, y: f.py, radius: f.comprimento * pxPorMetro,
      angle: Math.min(360, Math.max(1, f.angulo)), rotation: f.direcao, curvature: "round"
    };
  }
  if (f.tipo === "linha") {
    return {
      type: "line", x: f.px, y: f.py, length: f.comprimento * pxPorMetro,
      width: Math.max(1, f.largura * pxPorMetro), rotation: f.direcao
    };
  }
  return { type: "circle", x: f.px, y: f.py, radius: f.raio * pxPorMetro };
}

/**
 * As formas com cada linha dividida já em partes: N linhas de comprimento
 * L/N, uma depois da outra na mesma direção. É como a área sai antes de o
 * jogador virar as partes. Cada parte sabe de que linha veio (`grupo`) e
 * qual é (`parte` de `partes`), para o posicionamento virar as seguintes.
 */
export function expandirDivisoes(formas) {
  const saida = [];
  formas.forEach((f, grupo) => {
    const partes = f.tipo === "linha" ? Math.max(1, Math.floor(f.divisoes ?? 1)) : 1;
    if (partes === 1) {
      saida.push({ ...f, grupo, parte: 0, partes: 1 });
      return;
    }
    const pedaco = f.comprimento / partes;
    const passo = girar({ x: pedaco, y: 0 }, f.rotacao);
    for (let parte = 0; parte < partes; parte++) {
      saida.push({
        ...f, comprimento: pedaco, divisoes: 1,
        x: f.x + passo.x * parte, y: f.y + passo.y * parte,
        grupo, parte, partes
      });
    }
  });
  return saida;
}

/** Onde uma linha da região termina, em pixels. */
export function fimDaLinha(shape) {
  const a = rad(shape.rotation ?? 0);
  return { x: shape.x + Math.cos(a) * shape.length, y: shape.y + Math.sin(a) * shape.length };
}

/** Os pontos que contornam a forma, para o desenho e para medir o espaço. */
export function contornoDaForma(forma, origem = { x: 0, y: 0 }, giro = 0, escala = 1) {
  const f = formaNoLugar(forma, origem, giro, escala);
  const em = (angulo, distancia) => ({
    x: f.px + Math.cos(rad(angulo)) * distancia,
    y: f.py + Math.sin(rad(angulo)) * distancia
  });
  if (f.tipo === "cone") {
    const abertura = Math.min(360, Math.max(1, f.angulo));
    const r = f.comprimento * escala;
    const pontos = [{ x: f.px, y: f.py }];
    const passos = Math.max(2, Math.ceil(abertura / 10));
    for (let i = 0; i <= passos; i++) pontos.push(em(f.direcao - abertura / 2 + (abertura * i) / passos, r));
    return pontos;
  }
  if (f.tipo === "linha") {
    const lado = girar({ x: 0, y: (f.largura * escala) / 2 }, f.direcao);
    const frente = em(f.direcao, f.comprimento * escala);
    return [
      { x: f.px + lado.x, y: f.py + lado.y },
      { x: frente.x + lado.x, y: frente.y + lado.y },
      { x: frente.x - lado.x, y: frente.y - lado.y },
      { x: f.px - lado.x, y: f.py - lado.y }
    ];
  }
  const pontos = [];
  for (let i = 0; i < 36; i++) pontos.push(em(i * 10, f.raio * escala));
  return pontos;
}

/**
 * O desenho da área para a ficha, em SVG. A grade é de 1 m (um espaço do
 * mapa), a origem é o ponto de onde a área é posicionada e a seta diz para
 * onde ela aponta antes de alguém girá-la com a roda do mouse.
 */
export function svgDaArea(formas) {
  const partes = expandirDivisoes(formas);
  const contornos = partes.map(f => contornoDaForma(f));
  const todos = [{ x: 0, y: 0 }, ...contornos.flat()];
  const margem = 1;
  const minX = Math.floor(Math.min(...todos.map(p => p.x)) - margem);
  const maxX = Math.ceil(Math.max(...todos.map(p => p.x)) + margem);
  const minY = Math.floor(Math.min(...todos.map(p => p.y)) - margem);
  const maxY = Math.ceil(Math.max(...todos.map(p => p.y)) + margem);
  const largura = Math.max(2, maxX - minX);
  const altura = Math.max(2, maxY - minY);
  // Uma área muito grande não desenha cada metro: a grade vira ruído.
  const passo = Math.max(1, 10 ** Math.floor(Math.log10(Math.max(largura, altura) / 10)));
  const linhas = [];
  for (let x = Math.ceil(minX / passo) * passo; x <= maxX; x += passo) {
    linhas.push(`<line class="grade" x1="${x}" y1="${minY}" x2="${x}" y2="${maxY}"/>`);
  }
  for (let y = Math.ceil(minY / passo) * passo; y <= maxY; y += passo) {
    linhas.push(`<line class="grade" x1="${minX}" y1="${y}" x2="${maxX}" y2="${y}"/>`);
  }
  const formasSvg = contornos.map((pontos, i) =>
    `<polygon class="forma forma-${partes[i].grupo % 4}" points="${pontos.map(p => `${p.x.toFixed(3)},${p.y.toFixed(3)}`).join(" ")}"/>`);
  const t = Math.max(largura, altura) / 40;
  // As emendas de uma linha dividida: é dali que a parte seguinte pode virar.
  const emendas = partes.filter(f => f.parte > 0).map(f =>
    `<circle class="emenda" cx="${f.x.toFixed(3)}" cy="${f.y.toFixed(3)}" r="${t * 0.8}"/>`);
  const origem = `<circle class="origem" cx="0" cy="0" r="${t * 1.2}"/>
    <path class="seta" d="M ${t * 2} 0 L ${t * 5} 0 M ${t * 4} ${-t} L ${t * 5} 0 L ${t * 4} ${t}"/>`;
  return `<svg class="pyro-area-svg" viewBox="${minX} ${minY} ${largura} ${altura}"
    preserveAspectRatio="xMidYMid meet" style="--traco: ${t / 4}">
    ${linhas.join("")}${formasSvg.join("")}${emendas.join("")}${origem}</svg>`;
}

/* -------------------------------------------------------------------------- */
/*  Card e mapa                                                                */
/* -------------------------------------------------------------------------- */

/**
 * O que o card guarda da área: o nome e as formas já em número. Com a conta
 * feita na hora da conjuração, o botão põe no mapa exatamente o que foi
 * conjurado, mesmo que a magia mude depois.
 */
export function dadosDaAreaNoCard(item, vars) {
  const area = item?.system?.area;
  if (!area?.ativa || !(area.formas ?? []).length) return null;
  // O card guarda só as medidas: o aviso de variável faltando é da ficha.
  const formas = resolverArea(area, vars).map(f => {
    const medidas = { ...f };
    delete medidas.faltando;
    return medidas;
  });
  if (!formas.length) return null;
  const { valor, unidade, turnos } = duracaoDaArea(area, vars);
  const presa = !!area.presa;
  return {
    nome: item.name, formas, duracao: { valor, unidade, turnos }, presa,
    // Presa ao conjurador, a área sai uma vez só, em volta dele.
    alvos: presa ? 1 : alvosDaArea(area, vars).valor
  };
}

/**
 * Quantas vezes a área inteira sai: com 5 alvos, uma área de uma linha de
 * 5 m são 5 linhas de 5 m, cada uma posicionada no seu lugar. Mínimo 1.
 * @returns {{valor: number, faltando: string[]}}
 */
export function alvosDaArea(area, vars = {}) {
  const conta = calcularMedida(area?.alvos ?? "1", vars);
  return { valor: Math.max(1, Math.floor(conta.valor)), faltando: conta.faltando };
}

/**
 * Quanto a região fica no mapa, na unidade escrita e em turnos, que é o que
 * o relógio desconta (ver vencerAreas em tempo.mjs). O mínimo é 1: a área
 * instantânea dura até o turno passar, e uma fórmula que deu 0 (a runa de
 * duração ficou de fora da frase) não pode sumir antes disso.
 *
 * @returns {{valor: number, unidade: string, turnos: number, faltando: string[]}}
 */
export function duracaoDaArea(area, vars = {}) {
  const unidade = PYRO.unidadesDeManutencao[area?.unidade] ? area.unidade : "turnos";
  const conta = calcularMedida(area?.duracao ?? "1", vars);
  const valor = Math.max(1, Math.floor(conta.valor));
  return {
    valor, unidade,
    turnos: valor * (PYRO.unidadesDeManutencao[unidade]?.turnos ?? 1),
    faltando: conta.faltando
  };
}

/** "1 turno", "3 minutos". */
export function textoDaDuracao({ valor, unidade }) {
  const cfg = PYRO.unidadesDeManutencao[unidade] ?? PYRO.unidadesDeManutencao.turnos;
  return `${valor} ${loc(valor === 1 ? cfg.um : cfg.varios)}`;
}

/** O botão "Posicionar área" do card, com o tamanho de cada forma e a duração. */
export function htmlBotaoArea(dados) {
  if (!dados) return "";
  const duracao = dados.duracao
    ? ` · ${esc(loc("PYRO.Area.Dura", { tempo: textoDaDuracao(dados.duracao) }))}` : "";
  const alvos = (dados.alvos ?? 1) > 1 ? ` · ${esc(loc("PYRO.Area.Alvos", { n: dados.alvos }))}` : "";
  const rotulo = dados.presa ? loc("PYRO.Area.Prender") : loc("PYRO.Area.Posicionar");
  return `<div class="pyro-area-card">
    <button type="button" class="pyro-posicionar-area">
      <i class="fa-solid ${dados.presa ? "fa-link" : "fa-draw-polygon"}"></i> ${rotulo}</button>
    <span class="pyro-nota">${dados.formas.map(f => esc(textoDaForma(f))).join(" · ")}${alvos}${duracao}</span>
  </div>`;
}

/**
 * Põe a área no mapa como uma região, com um clique onde ela fica e a roda
 * do mouse girando a área inteira.
 *
 * O Foundry posiciona uma forma de cada vez, e cada uma sairia solta. Aqui
 * a colocação é conduzida por fora: o sistema move e gira todas as formas
 * juntas, a partir do ponto e do giro do mouse, e o desenho que a ficha
 * mostra é o que cai no mapa.
 *
 * Depois disso vêm as escolhas da hora: cada parte de uma linha dividida
 * sai do fim da anterior e aponta para onde o mouse estiver, e com vários
 * alvos a área inteira é posicionada de novo para cada um. Tudo vira uma
 * região só, criada no fim; Esc em qualquer passo desiste de tudo.
 */
export async function posicionarArea(dados, { nome } = {}) {
  if (!canvas?.ready || !canvas.scene) {
    ui.notifications.warn(loc("PYRO.Area.SemCena"));
    return null;
  }
  const formas = dados?.formas ?? [];
  if (!formas.length) return null;
  const pxPorMetro = canvas.dimensions.distancePixels;
  const alvos = Math.max(1, Math.floor(Number(dados.alvos) || 1));
  const partes = expandirDivisoes(formas);

  const dadosDaRegiao = {
    ...dadosBaseDaRegiao(dados, nome),
    ...(canvas.level ? { levels: [canvas.level.id] } : {})
  };
  const noGrid = (position, snap) => (snap
    ? canvas.grid.getSnappedPoint(position, {
      mode: CONST.GRID_SNAPPING_MODES.CENTER | CONST.GRID_SNAPPING_MODES.VERTEX
    })
    : position);

  // As formas já decididas, das cópias anteriores e dos passos anteriores.
  const decididas = [];
  let aviso = null;
  const avisar = (chave, dados) => {
    fecharAviso(aviso);
    aviso = ui.notifications.info(loc(chave, dados));
  };

  for (let alvo = 1; alvo <= alvos; alvo++) {
    const sufixo = alvos > 1 ? loc("PYRO.Area.AlvoDe", { n: alvo, total: alvos }) : "";

    /* Passo 1: a origem e o giro da área inteira. */
    let origem = { x: 0, y: 0 };
    let giro = 0;
    const montar = () => partes.map(f => formaDaRegiao(f, origem, giro, pxPorMetro));
    avisar("PYRO.Area.Instrucao", { alvo: sufixo });
    const posta = await passoDeRegiao(dadosDaRegiao, decididas, montar, {
      onMove: position => { origem = position; },
      onRotate: delta => {
        if (delta) giro = Math.round((giro + delta) / Math.abs(delta)) * Math.abs(delta);
      },
      noGrid
    });
    if (!posta) return fecharAviso(aviso);
    const atuais = montar();

    /* Passo 2: a direção de cada parte das linhas divididas. */
    for (let i = 0; i < partes.length; i++) {
      const f = partes[i];
      if (f.parte === 0) continue;
      const doGrupo = partes.map((g, k) => ({ g, k }))
        .filter(({ g }) => g.grupo === f.grupo && g.parte >= f.parte).map(({ k }) => k);
      const inicio = fimDaLinha(atuais[i - 1]);
      let direcao = atuais[i].rotation;
      // Esta parte e as seguintes, retas a partir do fim da anterior.
      const virar = () => {
        let ponto = inicio;
        for (const k of doGrupo) {
          atuais[k] = { ...atuais[k], x: ponto.x, y: ponto.y, rotation: direcao };
          ponto = fimDaLinha(atuais[k]);
        }
        return atuais;
      };
      avisar("PYRO.Area.InstrucaoParte", { parte: f.parte + 1, partes: f.partes, alvo: sufixo });
      const virada = await passoDeRegiao(dadosDaRegiao, decididas, virar, {
        onMove: position => {
          const dx = position.x - inicio.x;
          const dy = position.y - inicio.y;
          if (dx || dy) direcao = (Math.atan2(dy, dx) * 180) / Math.PI;
        },
        noGrid,
        girar: false
      });
      if (!virada) return fecharAviso(aviso);
      virar();
    }
    decididas.push(...atuais);
  }

  fecharAviso(aviso);
  return CONFIG.Region.documentClass.create({ ...dadosDaRegiao, shapes: decididas }, { parent: canvas.scene });
}

/** O que toda região de área leva, posta no mapa ou presa a um token. */
function dadosBaseDaRegiao(dados, nome) {
  return {
    name: nome ?? dados.nome ?? loc("PYRO.Area.Nome"),
    color: game.user.color?.css ?? String(game.user.color ?? ""),
    highlightMode: "coverage",
    displayMeasurements: true,
    visibility: CONST.REGION_VISIBILITY.ALWAYS,
    ownership: { [game.user.id]: CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER },
    // Os turnos que faltam: o relógio desconta e apaga a região no zero.
    flags: { [SYSTEM_ID]: { prazoArea: Math.max(1, Number(dados.duracao?.turnos) || 1) } }
  };
}

/**
 * Cola a área no token de quem conjurou, sem passar pelo mapa: a origem é o
 * centro do token e a frente da área é a frente dele. Presa ao token, a
 * região anda e gira com ele (o Foundry v14 leva junto as regiões presas).
 *
 * A frente de um token sem giro é o sul, que é para onde a arte costuma
 * olhar; é para lá que a seta do desenho da ficha aponta quando a área cola.
 * Linhas divididas saem retas: não há hora de escolher a direção de cada
 * parte, e a área presa é uma só.
 */
export async function prenderAoToken(dados, token, { nome } = {}) {
  const formas = dados?.formas ?? [];
  if (!formas.length || !token?.parent) return null;
  const cena = token.parent;
  const pxPorMetro = cena.dimensions?.distancePixels ?? canvas.dimensions.distancePixels;
  const centro = token.getMovementOrigin?.(token._source) ?? token.object?.center
    ?? { x: token.x, y: token.y };
  const giro = 90 + (Number(token.rotation) || 0);
  const shapes = expandirDivisoes(formas).map(f => formaDaRegiao(f, centro, giro, pxPorMetro));
  const nivel = token._source?.level ?? token.level;
  return CONFIG.Region.documentClass.create({
    ...dadosBaseDaRegiao(dados, nome),
    shapes,
    attachment: { token: token.id },
    // O Foundry só aceita a região presa no nível do token e escondida junto com ele.
    ...(nivel ? { levels: [nivel] } : {}),
    hidden: !!token.hidden
  }, { parent: cena });
}

/** Tira da tela o aviso do passo em andamento. */
function fecharAviso(aviso) {
  try {
    if (aviso) ui.notifications.remove?.(aviso);
  } catch {
    // Aviso que já saiu sozinho da tela não tem o que fechar.
  }
  return null;
}

/**
 * Um passo do posicionamento: o Foundry acompanha o mouse, e o sistema
 * redesenha a prévia inteira a cada movimento com o que `montar` devolve,
 * por cima das formas já decididas. A última forma da lista é a que o
 * Foundry acompanha; as outras vêm antes dela.
 *
 * @returns {Promise<boolean>} false quando o jogador desistiu (Esc).
 */
async function passoDeRegiao(dadosDaRegiao, decididas, montar, { onMove, onRotate, noGrid, girar = true }) {
  const aplicar = (document, preview, shape) => {
    const lista = [...decididas, ...montar()];
    shape.updateSource(lista.at(-1));
    document.updateSource({ shapes: [...lista.slice(0, -1), shape] });
    document.updateShapeConstraints();
    preview.renderFlags.set({ refreshShapes: true });
  };
  const inicial = [...decididas, ...montar()];
  const resultado = await canvas.regions.placeRegion({ ...dadosDaRegiao, shapes: [inicial.at(-1)] }, {
    create: false,
    allowRotation: girar,
    // O botão direito pularia a forma e deixaria o resto pela metade.
    preSkip: () => false,
    onMove: ({ position, snap, document, preview, shape }) => {
      onMove(noGrid(position, snap));
      aplicar(document, preview, shape);
      return false;
    },
    onRotate: ({ event, precise, document, preview, shape }) => {
      onRotate?.((precise ? 5 : 15) * Math.sign(event.delta));
      aplicar(document, preview, shape);
      return false;
    }
  });
  return !!resultado;
}

/** Os tipos de forma no formato que o selectOptions espera. */
export const opcoesDeTipo = () =>
  Object.fromEntries(Object.entries(TIPOS_DE_FORMA).map(([k, v]) => [k, v.label]));

/**
 * As formas que a área sugere a partir das runas da magia: um círculo para
 * cada runa com raio (Explosão, Aura), um cone para o Cone e uma linha para
 * o resto que tem comprimento (Linha, Muro). Cada medida já aponta para a
 * variável da própria runa.
 * @param {Record<string, Record<string, number>>} runas ver variaveisDasRunas.
 */
export function sugestaoDasRunas(runas) {
  const formas = [];
  for (const [chave, valores] of Object.entries(runas ?? {})) {
    if ("raio" in valores) formas.push({ ...formaNova("circulo"), raio: `@runas.${chave}.raio` });
    else if ("comprimento" in valores) {
      const tipo = chave.startsWith("cone") ? "cone" : "linha";
      formas.push({ ...formaNova(tipo), comprimento: `@runas.${chave}.comprimento` });
    }
  }
  return formas;
}

/**
 * A variável de alvos que a área sugere: o escalonamento "Alvos" de alguma
 * runa (o Dividir) ou o traço Alvos da técnica. Null quando não há.
 */
export function alvosSugeridos({ runas = null, tracos = [] } = {}) {
  for (const [chave, valores] of Object.entries(runas ?? {})) {
    if ("alvos" in valores) return `@runas.${chave}.alvos`;
  }
  return tracos.includes("alvos") ? "@alvos" : null;
}

/** O mesmo para a técnica, pelos traços de Área, Cone e Linha. */
export function sugestaoDosTracos(chaves) {
  const formas = [];
  for (const chave of chaves ?? []) {
    if (chave === "area") formas.push({ ...formaNova("circulo"), raio: "@area" });
    else if (chave === "cone") formas.push({ ...formaNova("cone"), comprimento: "@cone" });
    else if (chave === "linha") formas.push({ ...formaNova("linha"), comprimento: "@linha" });
  }
  return formas;
}
