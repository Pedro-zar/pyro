import { PYRO } from "./config.mjs";

/**
 * Converte um valor de atributo na pool da Tabela de Dados (SRD Atributos).
 * A tabela termina em 50; acima disso vale a última linha.
 * @returns {{n: number, faces: number}} faces 0 é o valor fixo "1" do atributo 1.
 */
export function poolDoAtributo(valor) {
  const v = Math.clamp(Math.round(valor), 1, 50);
  const formula = PYRO.tabelaDados[v];
  if (formula === "1") return { n: 1, faces: 0 };
  const [n, faces] = formula.split("d").map(Number);
  return { n, faces };
}

/**
 * Monta a fórmula final de um teste de atributo.
 * Vantagem soma dados na pool, desvantagem remove (SRD §6).
 * Retorna null se a pool cair a 0 dados (falha automática).
 */
export function formulaTeste(valor, { vantagem = 0, desvantagem = 0, bonus = 0 } = {}) {
  // "+ -2" rola, mas ninguém escreve assim: o sinal entra no operador.
  const comBonus = base => (!bonus ? base
    : bonus > 0 ? `${base} + ${bonus}` : `${base} - ${-bonus}`);
  const pool = poolDoAtributo(valor);
  if (pool.faces === 0) {
    // Atributo 1: valor fixo. Vantagem/desvantagem não se aplicam a um dado fixo.
    return comBonus("1");
  }
  const n = pool.n + vantagem - desvantagem;
  if (n <= 0) return null;
  return comBonus(`${n}d${pool.faces}`);
}

/**
 * Fórmula final de uma reação (esquiva ou bloqueio) a partir da fórmula da
 * ficha ("4d12 + 2d4"). Vantagem soma dados do dado da reação (d12 na
 * esquiva, d4 no bloqueio) e desvantagem tira; a cobertura dobra todos os
 * dados; o bônus fixo entra no fim. Sem dado nenhum sobrando, null: falha
 * automática, a mesma regra da pool zerada nos testes de atributo.
 */
export function formulaReacao(formula, faces, { vantagem = 0, desvantagem = 0, bonus = 0, cobertura = false } = {}) {
  const termo = new RegExp(`(^|\\s)(\\d+)d${faces}(?!\\d)`);
  let f = juntarDados([formula]);
  const m = termo.exec(f);
  const atual = m ? Number(m[2]) : 0;
  const novo = atual + vantagem - desvantagem;
  if (m) f = f.replace(termo, novo > 0 ? `$1${novo}d${faces}` : "$1").trim();
  else if (novo > 0) f = juntarDados([`${novo}d${faces}`, f]);
  // Tirar o termo do meio pode deixar "+ 2d4" ou "2d12 + " para trás.
  f = juntarDados([f]);
  if (!/\dd\d/.test(f)) return null;
  if (cobertura) f = f.replace(/(\d+)d(\d+)/g, (x, n, fc) => `${Number(n) * 2}d${fc}`);
  bonus = Number(bonus) || 0;
  return !bonus ? f : bonus > 0 ? `${f} + ${bonus}` : `${f} - ${-bonus}`;
}

/*
 * Um ramo de degrau vai até o ";" ou até o "]" que fecha o degrau — mas um
 * atalho escrito dentro dele ("[NVL10=2d6 + [FOR];1d6]") traz o próprio par de
 * colchetes, que não pode encerrar nada.
 */
const RAMO = String.raw`(?:\[[A-Za-z]+\]|[^;\]])*`;
const DEGRAU_DE_NIVEL = new RegExp(String.raw`\[NVL(\d+)\s*=\s*(${RAMO});(${RAMO})\]`, "gi");

/**
 * Prepara a fórmula escrita na ficha para o Roll do Foundry.
 *
 * Atalhos de atributo: [VIG], [FOR]... viram @vig, @for — o atributo em jogo
 * (com os efeitos somados) entra na conta via getRollData. [NVL] é o nível do
 * próprio item (a magia, a habilidade, a técnica que está sendo usada), e não
 * um atributo de quem usa: é o que faz "1d6 + [NVL]" crescer com o uso, sem o
 * jogador reescrever a fórmula a cada nível.
 *
 * Degraus de nível: [NVL5=X;Y] vale X do nível 5 em diante e Y antes dele —
 * assim uma habilidade que dobra nos níveis 5, 10, 15 e 20 se escreve
 * "[NVL] * [NVL5=2;1] * [NVL10=2;1] * [NVL15=2;1] * [NVL20=2;1]". Os dois
 * lados podem ser qualquer expressão ("[NVL10=2d6;1d6]"), e por isso entram
 * entre parênteses; lado vazio vale 0.
 *
 * O degrau é resolvido aqui, e não pelo Roll, porque o Foundry não tem "se"
 * nas fórmulas — o que chega nele já é o ramo escolhido.
 *
 * @param {object} [dados] os mesmos dados da rolagem (getRollData), de onde
 *   sai o nível. Sem eles, todo degrau cai no ramo de antes.
 */
export function prepararFormula(formula, dados = null) {
  const nivel = Number(dados?.nvl) || 0;
  return String(formula ?? "")
    .replace(DEGRAU_DE_NIVEL, (m, degrau, sim, nao) => {
      const ramo = (nivel >= Number(degrau) ? sim : nao).trim();
      return `(${ramo || 0})`;
    })
    .replace(/\[(FOR|VIG|DES|AGI|INT|SAB|PRE|NVL)\]/gi, (m, sigla) => `@${sigla.toLowerCase()}`);
}

/**
 * Cola a unidade no número, sem espaço nenhum: quem escreveu "% de chance"
 * quer "10% de chance", e quem escreveu " de dano" já pôs o espaço.
 * Serve tanto para o resultado rolado quanto para a fórmula na ficha.
 */
export function comUnidade(valor, unidade) {
  const texto = String(valor ?? "").trim();
  return texto ? `${texto}${unidade ?? ""}` : "";
}

/** Fórmula "crua" da pool (sem ajustes) — usada em @dados.* e na iniciativa. */
export function formulaPool(valor) {
  const pool = poolDoAtributo(valor);
  return pool.faces === 0 ? "1" : `${pool.n}d${pool.faces}`;
}

/**
 * Multiplica só os dados de uma fórmula, deixando bônus e atributos como
 * estão: "2d6 + [FOR]" vezes 3 vira "6d6 + [FOR]".
 *
 * É o que a Potência das técnicas pede — "+1x dados de dano" dobra os dados de
 * uma katana, não a Força de quem a segura.
 *
 * O multiplicador é fracionário e o resultado desce para o dado inteiro de
 * baixo, parcela por parcela: 4d4 a 1,25x são 5d4, mas 1d8 a 1,25x continua
 * 1d8 — um golpe de um dado só espera a Potência fechar um 1x inteiro para
 * ganhar o segundo. Nunca some abaixo de um dado: o ataque existe.
 */
export function multiplicarDados(formula, mult) {
  const m = Math.max(0, Number(mult) || 0);
  if (m === 1) return String(formula ?? "");
  return String(formula ?? "").replace(/(\d*)d(\d+)/gi,
    (termo, n, faces) => `${Math.max(1, Math.floor((n === "" ? 1 : Number(n)) * m))}d${faces}`);
}

/**
 * Junta várias fórmulas numa só, somando os dados de mesmas faces.
 *
 * Um bloqueio com escudo e brincos seria "2d4 + 2d4 + 2d4" no botão, que não
 * cabe na ficha; a rolagem é a mesma, então o que aparece é o total: "6d4".
 * Dados de faces diferentes continuam separados, porque 1d4 e 1d12 não viram
 * um dado só, e o que não for dado nem número ([FOR], @sab) passa intacto
 * para o Roll resolver.
 */
export function juntarDados(partes) {
  const porFaces = new Map();
  const soltos = [];
  let fixo = 0;

  for (const parte of partes) {
    if (!parte) continue;
    const termos = String(parte).replace(/([+-])/g, " $1 ").split(/\s+/).filter(Boolean);
    let sinal = 1;
    for (const termo of termos) {
      if (termo === "+" || termo === "-") { sinal = termo === "+" ? 1 : -1; continue; }
      const dado = /^(\d*)d(\d+)$/i.exec(termo);
      if (dado) {
        const faces = Number(dado[2]);
        const n = dado[1] === "" ? 1 : Number(dado[1]);
        porFaces.set(faces, (porFaces.get(faces) ?? 0) + sinal * n);
      }
      else if (/^\d+$/.test(termo)) fixo += sinal * Number(termo);
      else soltos.push(sinal < 0 ? `-${termo}` : termo);
      sinal = 1;
    }
  }

  // Dados maiores primeiro: "2d12 + 1d4" lê melhor que o contrário.
  const pedacos = [...porFaces.entries()]
    .sort(([a], [b]) => b - a)
    .filter(([, n]) => n !== 0)
    .map(([faces, n]) => (n > 0 ? `${n}d${faces}` : `-${-n}d${faces}`));
  pedacos.push(...soltos);
  if (fixo) pedacos.push(String(fixo));

  return pedacos.reduce((texto, p) => {
    if (!texto) return p;
    return p.startsWith("-") ? `${texto} - ${p.slice(1)}` : `${texto} + ${p}`;
  }, "");
}
