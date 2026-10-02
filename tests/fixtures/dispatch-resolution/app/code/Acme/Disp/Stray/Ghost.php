<?php
namespace Acme\Hidden;

/**
 * F1: a class no autoloader can load — its namespace has no folder of its own (not app/code/Acme/Hidden,
 * no composer map), like a stale copy or an uninstalled module's folder. It never runs, so it never
 * dispatches; finding it by its file name would mean walking the whole tree.
 */
class Ghost extends \Acme\Disp\Model\AbstractModel
{
    protected $_eventPrefix = 'acme_ghost';
}
